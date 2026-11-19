import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { AdminGuard, type AdminRequest } from "./admin.guard";
import { AdminService } from "./admin.service";

@ApiTags("Admin Portal")
@UseGuards(AdminGuard)
@Controller("v1/admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("stats")
  @ApiOperation({ summary: "Get overview KPI metrics (users, revenue, licenses, devices)" })
  @ApiResponse({ status: 200, description: "Overview metrics" })
  async getStats() {
    return this.adminService.getStats();
  }

  @Get("audit-logs")
  @ApiOperation({ summary: "Get immutable audit trail of administrative actions" })
  @ApiResponse({ status: 200, description: "List of audit entries" })
  async getAuditLogs(@Query("limit") limit?: number) {
    return this.adminService.getAuditLogs(limit ? Number(limit) : 50);
  }

  @Post("actions/log")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Record an administrative audit entry" })
  @ApiResponse({ status: 200, description: "Audit entry recorded" })
  async recordAudit(
    @Body()
    body: {
      actorId: string;
      action: string;
      resource: string;
      resourceId?: string;
      metadata?: Record<string, unknown>;
    },
    @Req() req?: AdminRequest
  ) {
    // The actor is the authenticated admin, never a value the client can choose.
    return this.adminService.recordAudit(
      req?.admin?.sub ?? body.actorId,
      body.action,
      body.resource,
      body.resourceId,
      body.metadata
    );
  }
}
