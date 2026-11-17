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
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { BillingService } from "./billing.service";
import { CreateCheckoutSessionDto } from "./dto/billing.dto";

@ApiTags("Billing & Payments")
@Controller("v1/billing")
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post("checkout-session")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Create a hosted checkout session URL for purchasing a license" })
  @ApiResponse({ status: 200, description: "Hosted checkout URL returned" })
  async createCheckoutSession(@Body() dto: CreateCheckoutSessionDto) {
    return this.billingService.createCheckoutSession(dto.userId, dto.planId, dto.returnUrl);
  }

  @Post("webhook/:provider")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Idempotent payment webhook endpoint for Polar / Lemon Squeezy" })
  @ApiResponse({ status: 200, description: "Webhook processed or recognized as duplicate" })
  @ApiResponse({ status: 401, description: "Invalid webhook HMAC signature" })
  async handleWebhook(
    @Param("provider") provider: string,
    @Headers("x-polar-signature") polarSig: string | undefined,
    @Headers("x-signature") lemonSig: string | undefined,
    @Body() payload: Record<string, unknown>,
    @Req() req: Request
  ) {
    const signature = polarSig || lemonSig;
    // Format raw string for signature validation
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(payload);
    return this.billingService.handleWebhook(provider, rawBody, signature, payload);
  }

  @Get("invoices")
  @ApiOperation({ summary: "Get customer invoice and receipt history" })
  @ApiResponse({ status: 200, description: "List of invoice receipts with amounts in minor units" })
  async getInvoices(@Query("userId") userId: string) {
    return this.billingService.getInvoices(userId);
  }
}
