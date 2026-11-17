import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, IsUUID } from "class-validator";

export class ActivateLicenseDto {
  @ApiProperty({ example: "MJDM-XXXXX-XXXXX-XXXXX-XXXXX" })
  @IsString()
  @IsNotEmpty()
  licenseKey!: string;

  @ApiProperty({ example: "123e4567-e89b-12d3-a456-426614174000" })
  @IsUUID()
  @IsNotEmpty()
  deviceUuid!: string;

  @ApiProperty({ example: "windows", enum: ["windows", "linux", "macos"] })
  @IsString()
  @IsNotEmpty()
  platform!: string;

  @ApiPropertyOptional({ example: "Windows 11 23H2" })
  @IsOptional()
  @IsString()
  osVersion?: string;

  @ApiPropertyOptional({ example: "1.0.0" })
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiPropertyOptional({ example: "Workstation-PC" })
  @IsOptional()
  @IsString()
  deviceName?: string;
}

export class ValidateLicenseDto {
  @ApiProperty({ description: "Signed ES256 JWS token" })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class RefreshLicenseDto {
  @ApiProperty({ example: "123e4567-e89b-12d3-a456-426614174000" })
  @IsUUID()
  @IsNotEmpty()
  licenseId!: string;

  @ApiProperty({ example: "123e4567-e89b-12d3-a456-426614174000" })
  @IsUUID()
  @IsNotEmpty()
  deviceUuid!: string;
}

export class DeactivateLicenseDto {
  @ApiProperty({ example: "123e4567-e89b-12d3-a456-426614174000" })
  @IsUUID()
  @IsNotEmpty()
  licenseId!: string;

  @ApiProperty({ example: "123e4567-e89b-12d3-a456-426614174000" })
  @IsUUID()
  @IsNotEmpty()
  deviceUuid!: string;
}
