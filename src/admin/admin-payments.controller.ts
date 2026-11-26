import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import { PaymentsService } from "../payments/payments.service";
import { AdminGuard, type AdminRequest } from "./admin.guard";
import { AdminService } from "./admin.service";

export class SaveGatewayDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(["live", "test"])
  mode?: string;

  @IsOptional()
  @IsObject()
  values?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  clearSecrets?: string[];
}

export class AddNumberDto {
  @IsString()
  @MaxLength(20)
  number!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}

export class PatchNumberDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}

export class NoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

@ApiTags("Admin Payments")
@UseGuards(AdminGuard)
@Controller("v1/admin/payments")
export class AdminPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly admin: AdminService
  ) {}

  private who(req: AdminRequest): string {
    return req.admin?.sub ?? "admin";
  }

  // ── gateways ──
  @Get("gateways")
  @ApiOperation({ summary: "All gateways with their fields. Secret values are never returned, only whether they are set." })
  gateways() {
    return this.payments.adminGateways();
  }

  @Put("gateways/:slug")
  @ApiOperation({ summary: "Turn a gateway on or off and save its settings (secrets are write-only)" })
  async saveGateway(@Param("slug") slug: string, @Body() dto: SaveGatewayDto, @Req() req: AdminRequest) {
    await this.payments.saveGateway(slug, dto, this.who(req));
    await this.admin.recordAudit(this.who(req), "payment.gateway.update", "payment-gateway", undefined, { slug, enabled: dto.enabled, mode: dto.mode }, req.ip);
    return { success: true };
  }

  // ── bKash numbers ──
  @Get("bkash-numbers")
  numbers() {
    return this.payments.listNumbers();
  }

  @Post("bkash-numbers")
  async addNumber(@Body() dto: AddNumberDto, @Req() req: AdminRequest) {
    const made = await this.payments.addNumber(dto.number, dto.label);
    await this.admin.recordAudit(this.who(req), "payment.bkash-number.add", "bkash-number", made.id, {}, req.ip);
    return made;
  }

  @Patch("bkash-numbers/:id")
  async patchNumber(@Param("id", new ParseUUIDPipe()) id: string, @Body() dto: PatchNumberDto) {
    await this.payments.updateNumber(id, { enabled: dto.enabled, label: dto.label });
    return { success: true };
  }

  @Delete("bkash-numbers/:id")
  async removeNumber(@Param("id", new ParseUUIDPipe()) id: string, @Req() req: AdminRequest) {
    await this.payments.removeNumber(id);
    await this.admin.recordAudit(this.who(req), "payment.bkash-number.remove", "bkash-number", id, {}, req.ip);
    return { success: true };
  }

  // ── orders ──
  @Get("orders")
  orders(@Query("status") status?: string) {
    return this.payments.adminOrders(status && status !== "all" ? status : undefined);
  }

  @Post("orders/:id/mark-paid")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "The customer paid outside the system: mark it paid and issue the license" })
  async markPaid(@Param("id", new ParseUUIDPipe()) id: string, @Body() dto: NoteDto, @Req() req: AdminRequest) {
    const o = await this.payments.markPaidByAdmin(id, this.who(req), dto.note);
    await this.admin.recordAudit(this.who(req), "payment.order.mark-paid", "order", id, { note: dto.note }, req.ip);
    return { status: o.status };
  }

  @Post("orders/:id/retry-license")
  @HttpCode(HttpStatus.OK)
  async retryLicense(@Param("id", new ParseUUIDPipe()) id: string, @Req() req: AdminRequest) {
    const o = await this.payments.retryLicense(id, this.who(req));
    await this.admin.recordAudit(this.who(req), "payment.order.retry-license", "order", id, {}, req.ip);
    return { licenseId: o.licenseId };
  }

  @Post("orders/:id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancel(@Param("id", new ParseUUIDPipe()) id: string, @Req() req: AdminRequest) {
    await this.payments.cancelOrder(id);
    await this.admin.recordAudit(this.who(req), "payment.order.cancel", "order", id, {}, req.ip);
    return { success: true };
  }

  @Post("orders/:id/refund")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark a paid order refunded; its license is revoked" })
  async refund(@Param("id", new ParseUUIDPipe()) id: string, @Req() req: AdminRequest) {
    await this.payments.refundOrder(id);
    await this.admin.recordAudit(this.who(req), "payment.order.refund", "order", id, {}, req.ip);
    return { success: true };
  }

  // ── manual payment reports ──
  @Get("submissions")
  submissions(@Query("status") status?: string) {
    return this.payments.adminSubmissions(status && status !== "all" ? status : undefined);
  }

  @Post("submissions/:id/approve")
  @HttpCode(HttpStatus.OK)
  async approve(@Param("id", new ParseUUIDPipe()) id: string, @Body() dto: NoteDto, @Req() req: AdminRequest) {
    const o = await this.payments.approveSubmission(id, this.who(req), dto.note);
    await this.admin.recordAudit(this.who(req), "payment.report.approve", "payment-report", id, { order: o.id }, req.ip);
    return { status: o.status };
  }

  @Post("submissions/:id/reject")
  @HttpCode(HttpStatus.OK)
  async reject(@Param("id", new ParseUUIDPipe()) id: string, @Body() dto: NoteDto, @Req() req: AdminRequest) {
    await this.payments.rejectSubmission(id, this.who(req), dto.note);
    await this.admin.recordAudit(this.who(req), "payment.report.reject", "payment-report", id, { note: dto.note }, req.ip);
    return { success: true };
  }
}
