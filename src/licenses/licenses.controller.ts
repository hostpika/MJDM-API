import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  ActivateLicenseDto,
  DeactivateLicenseDto,
  RefreshLicenseDto,
  ValidateLicenseDto,
} from "./dto/licenses.dto";
import { Es256Service } from "./es256.service";
import { LicensesService } from "./licenses.service";

@ApiTags("Licensing")
@Controller("v1/licenses")
export class LicensesController {
  constructor(
    private readonly licensesService: LicensesService,
    private readonly es256: Es256Service
  ) {}

  @Get("plans")
  @ApiOperation({ summary: "List available pricing & device plans" })
  @ApiResponse({ status: 200, description: "Active plans list" })
  getPlans() {
    return this.licensesService.getPlans();
  }

  @Get("public-key")
  @ApiOperation({ summary: "Get ES256 public key (PEM) for offline signature verification" })
  @ApiResponse({ status: 200, description: "Public key in PEM format" })
  getPublicKey() {
    return {
      kid: this.es256.keyId,
      algorithm: "ES256",
      publicKey: this.es256.getPublicKey(),
    };
  }

  @Post("activate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Activate license key for a device" })
  @ApiResponse({ status: 200, description: "Device activated, signed ES256 token returned" })
  @ApiResponse({ status: 409, description: "Device limit reached for plan" })
  async activate(@Body() dto: ActivateLicenseDto) {
    return this.licensesService.activate(dto);
  }

  @Post("validate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Validate an ES256 license token" })
  @ApiResponse({ status: 200, description: "Token validity and extracted claims" })
  validate(@Body() dto: ValidateLicenseDto) {
    return this.es256.verifyToken(dto.token);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Refresh an active device license token" })
  @ApiResponse({ status: 200, description: "Fresh token issued" })
  async refresh(@Body() dto: RefreshLicenseDto) {
    return this.licensesService.refresh(dto);
  }

  @Post("deactivate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Deactivate a device to free up an activation slot" })
  @ApiResponse({ status: 200, description: "Device deactivated" })
  async deactivate(@Body() dto: DeactivateLicenseDto) {
    return this.licensesService.deactivate(dto);
  }
}
