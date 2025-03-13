const SCALE_CACHE_SIZE = process.env.SCALE_CACHE_SIZE
  ? parseInt(process.env.SCALE_CACHE_SIZE)
  : 1000;

const isProduction = process.env.NODE_ENV === "production";

export { SCALE_CACHE_SIZE, isProduction };
