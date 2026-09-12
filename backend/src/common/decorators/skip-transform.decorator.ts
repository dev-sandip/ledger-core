import { SetMetadata } from '@nestjs/common';

export const SKIP_TRANSFORM_KEY = 'skipTransform';
export const SkipResponseTransform = () =>
  SetMetadata(SKIP_TRANSFORM_KEY, true);
