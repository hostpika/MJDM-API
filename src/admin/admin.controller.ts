import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { AdminService } from "./admin.service";

@ApiTags("Admin Portal")
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
    }
  ) {
    return this.adminService.recordAudit(
      body.actorId,
      body.action,
      body.resource,
      body.resourceId,
      body.metadata
    );
  }
}
