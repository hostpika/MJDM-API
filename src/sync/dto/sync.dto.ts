import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class KdfParamsDto {
  @IsString()
  @IsNotEmpty()
  alg!: string;

  @IsInt()
  @Min(1024)
  m!: number;

  @IsInt()
  @Min(1)
  t!: number;

  @IsInt()
  @Min(1)
  p!: number;

  @IsString()
  @IsNotEmpty()
  salt!: string;
}

export class SetupSyncDto {
  @IsObject()
  @ValidateNested()
  @Type(() => KdfParamsDto)
  kdf_params!: KdfParamsDto;

  @IsString()
  @IsNotEmpty()
  wrapped_mk!: string;

  @IsString()
  @IsNotEmpty()
  wrapped_mk_recovery!: string;
}

export class SyncRecordDto {
  @IsString()
  @IsIn(["settings", "categories", "queues_rules", "site_profiles"])
  collection!: string;

  @IsUUID()
  record_id!: string;

  @IsString()
  @IsNotEmpty()
  hlc!: string;

  @IsString()
  @IsNotEmpty()
  device_tag!: string;

  @IsBoolean()
  deleted!: boolean;

  @IsInt()
  @Min(1)
  schema_version!: number;

  @IsString()
  blob!: string; // Base64-encoded encrypted blob
}

export class PushSyncDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncRecordDto)
  records!: SyncRecordDto[];
}

export class PullSyncDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  cursor?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  collections?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
