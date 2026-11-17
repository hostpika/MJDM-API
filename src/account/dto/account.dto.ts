import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, MinLength } from "class-validator";

export class UpdateProfileDto {
  @ApiProperty({ description: "Customer display name", example: "Meraj Hossain", required: false })
  @IsOptional()
  @IsString()
  displayName?: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: "Existing account password", example: "OldPassword123!" })
  @IsString()
  currentPassword!: string;

  @ApiProperty({ description: "New account password (min 8 characters)", example: "NewPassword456!" })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
