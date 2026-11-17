import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from "class-validator";

export class PublishReleaseDto {
  @ApiProperty({ example: "1.0.0" })
  @IsString()
  @IsNotEmpty()
  version!: string;

  @ApiProperty({ example: "windows", enum: ["windows", "linux", "macos"] })
  @IsString()
  @IsNotEmpty()
  platform!: string;

  @ApiProperty({ example: "x86_64", enum: ["x86_64", "aarch64"] })
  @IsString()
  @IsNotEmpty()
  architecture!: string;

  @ApiProperty({ example: "stable", enum: ["stable", "beta"] })
  @IsEnum(["stable", "beta"])
  channel!: "stable" | "beta";

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional({ example: "Performance optimizations and bug fixes." })
  @IsOptional()
  @IsString()
  releaseNotes?: string;

  @ApiProperty({ example: "https://releases.mjdm.app/v1.0.0/mjdm-setup.exe" })
  @IsUrl()
  @IsNotEmpty()
  artifactUrl!: string;

  @ApiProperty({ example: 42100500 })
  @IsInt()
  @Min(1)
  fileSize!: number;

  @ApiProperty({ example: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" })
  @IsString()
  @IsNotEmpty()
  sha256!: string;

  @ApiPropertyOptional({
    example: "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk...",
  })
  @IsOptional()
  @IsString()
  signature?: string;

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  rolloutPercentage?: number;
}

export class CheckUpdateParamsDto {
  @ApiProperty({ example: "windows" })
  @IsString()
  @IsNotEmpty()
  target!: string;

  @ApiProperty({ example: "x86_64" })
  @IsString()
  @IsNotEmpty()
  arch!: string;

  @ApiProperty({ example: "0.9.0" })
  @IsString()
  @IsNotEmpty()
  currentVersion!: string;
}
