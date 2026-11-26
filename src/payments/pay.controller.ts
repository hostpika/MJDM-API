import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { PaymentsService } from "./payments.service";

export class CreateOrderDto {
  @IsIn(["lifetime", "annual"])
  plan!: string;

  @IsString()
  @MaxLength(255)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;
}

export class StartPaymentDto {
  @IsString()
  @MaxLength(40)
  gateway!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  coin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  network?: string;
}

export class SubmitPaymentDto {
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  trxId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sender?: string;
}

export class SmsDto {
  @IsString()
  @MaxLength(1000)
  text!: string;
}

/** The customer-facing checkout API. Everything is keyed by the order's secret token. */
@ApiTags("Checkout")
@Controller("v1/pay")
export class PayController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly limiter: RateLimiterService
  ) {}

  @Post("orders")
  @ApiOperation({ summary: "Start an order for a plan" })
  async create(@Body() dto: CreateOrderDto, @Req() req: Request) {
    this.limiter.check(`pay-order:${req.ip}`, 12, 10 * 60_000);
    const order = await this.payments.createOrder({ planKey: dto.plan, email: dto.email, name: dto.name });
    return this.methodsFor(order.token);
  }

  @Get("orders/:token")
  @ApiOperation({ summary: "Order status; the license key appears once it is paid" })
  async status(@Param("token") token: string, @Req() req: Request) {
    this.limiter.check(`pay-status:${req.ip}`, 120, 60_000);
    return this.payments.publicOrder(token);
  }

  @Get("orders/:token/methods")
  @ApiOperation({ summary: "Payment methods available for this order, with the amount to pay in each" })
  async methods(@Param("token") token: string) {
    return this.methodsFor(token);
  }

  @Post("orders/:token/start")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Choose a payment method" })
  async start(@Param("token") token: string, @Body() dto: StartPaymentDto, @Req() req: Request) {
    this.limiter.check(`pay-start:${req.ip}`, 30, 10 * 60_000);
    return this.payments.start(token, dto.gateway, { coin: dto.coin, network: dto.network });
  }

  @Post("orders/:token/submit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Report a manual payment (bKash TrxID or Binance transaction id)" })
  async submit(@Param("token") token: string, @Body() dto: SubmitPaymentDto, @Req() req: Request) {
    this.limiter.check(`pay-submit:${req.ip}`, 10, 10 * 60_000);
    return this.payments.submitManual(token, dto);
  }

  private async methodsFor(token: string) {
    const { order, methods } = await this.payments.methods(token);
    return {
      token: order.token,
      plan: order.planKey,
      email: order.email,
      expiresAt: order.expiresAt,
      methods,
    };
  }

  // ── gateway callbacks (no cookies; each one is verified by its own signature or secret) ──

  @Post("webhook/stripe")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Stripe webhook (checkout.session.completed)" })
  stripe(@Headers("stripe-signature") signature: string | undefined, @Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody ? req.rawBody.toString("utf8") : "";
    return this.payments.stripeWebhook(raw, signature);
  }

  @Post("webhook/cryptomus")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cryptomus payment callback" })
  cryptomus(@Body() payload: Record<string, unknown>) {
    return this.payments.cryptomusWebhook(payload);
  }

  @Post("webhook/bkash-sms")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Forwarded bKash SMS (approves matching manual payments)" })
  async sms(@Headers("x-sms-secret") secret: string | undefined, @Body() dto: SmsDto, @Req() req: Request) {
    this.limiter.check(`pay-sms:${req.ip}`, 120, 60_000);
    return this.payments.bkashSms(secret, dto.text);
  }

  @Get("callback/bkash")
  @ApiOperation({ summary: "Where bKash sends the customer after they pay" })
  async bkash(
    @Query("o") token: string,
    @Query("paymentID") paymentId: string,
    @Query("status") status: string,
    @Res() res: Response
  ) {
    const next = await this.payments.bkashCallback(String(token ?? ""), String(paymentId ?? ""), String(status ?? ""));
    res.redirect(302, next);
  }
}
