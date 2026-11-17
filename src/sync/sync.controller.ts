import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { TokenService } from "../auth/token.service";
import {
  PullSyncDto,
  PushSyncDto,
  SetupSyncDto,
} from "./dto/sync.dto";
import { SyncService } from "./sync.service";

@ApiTags("E2EE Cloud Sync")
@Controller("v1/sync")
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly tokenService: TokenService
  ) {}

  private extractUserId(authHeader?: string): string {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing or invalid Bearer authorization header");
    }
    const token = authHeader.slice(7).trim();
    try {
      const payload = this.tokenService.verifyAccessToken(token);
      return payload.sub;
    } catch {
      throw new UnauthorizedException("Invalid access token");
    }
  }

  @Post("setup")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Upload initial wrapped master key and KDF params" })
  @ApiResponse({ status: 200, description: "Sync account setup successful" })
  async setup(
    @Body() dto: SetupSyncDto,
    @Headers("authorization") authHeader?: string
  ) {
    const userId = this.extractUserId(authHeader);
    return this.syncService.setup(userId, dto);
  }

  @Get("setup")
  @ApiOperation({ summary: "Retrieve wrapped master key and KDF params for device enrollment" })
  @ApiResponse({ status: 200, description: "Sync account metadata" })
  async getSetup(@Headers("authorization") authHeader?: string) {
    const userId = this.extractUserId(authHeader);
    return this.syncService.getSetup(userId);
  }

  @Post("push")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Push local sync records to cloud storage (LWW upsert)" })
  @ApiResponse({ status: 200, description: "Push response with accepted/rejected counts" })
  async push(
    @Body() dto: PushSyncDto,
    @Headers("authorization") authHeader?: string
  ) {
    const userId = this.extractUserId(authHeader);
    return this.syncService.push(userId, dto);
  }

  @Post("pull")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Pull remote sync record changes since cursor" })
  @ApiResponse({ status: 200, description: "Batch of sync changes" })
  async pull(
    @Body() dto: PullSyncDto,
    @Headers("authorization") authHeader?: string
  ) {
    const userId = this.extractUserId(authHeader);
    return this.syncService.pull(userId, dto);
  }

  @Get("status")
  @ApiOperation({ summary: "Get current sync quota and usage statistics" })
  @ApiResponse({ status: 200, description: "Sync quota usage" })
  async getStatus(@Headers("authorization") authHeader?: string) {
    const userId = this.extractUserId(authHeader);
    return this.syncService.getStatus(userId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Purge all encrypted sync data and keys for user account" })
  @ApiResponse({ status: 200, description: "Sync data purged" })
  async deleteSync(@Headers("authorization") authHeader?: string) {
    const userId = this.extractUserId(authHeader);
    return this.syncService.deleteSync(userId);
  }
}
