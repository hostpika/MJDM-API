import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID } from "class-validator";

export class CreateCheckoutSessionDto {
  @ApiProperty({ example: "user-1234-uuid" })
  @IsUUID()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({ example: "plan-lifetime-pro" })
  @IsString()
  @IsNotEmpty()
  planId!: string;

  @ApiPropertyOptional({ example: "https://mjdm.app/portal/checkout-success" })
  @IsOptional()
  @IsUrl({ require_tld: false })
  returnUrl?: string;
}

export class WebhookHeadersDto {
  @ApiPropertyOptional({ description: "HMAC signature for Polar or Lemon Squeezy" })
  @IsOptional()
  @IsString()
  signature?: string;
}
