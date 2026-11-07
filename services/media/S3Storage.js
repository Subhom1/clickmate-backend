import { S3Client, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

// Credentials are resolved by the SDK's standard credential provider chain.
export function createS3Storage(env = process.env) {
  const { MEDIA_S3_BUCKET: bucket, MEDIA_S3_REGION: region, MEDIA_S3_ENDPOINT: endpoint } = env;
  if (!bucket || !region) throw new Error("MEDIA_S3_BUCKET and MEDIA_S3_REGION are required");
  if (endpoint && new URL(endpoint).protocol !== "https:") throw new Error("MEDIA_S3_ENDPOINT must use HTTPS");
  const client = new S3Client({ region, ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });
  return new S3Storage(client, bucket);
}

export class S3Storage {
  constructor(client, bucket) { this.client = client; this.bucket = bucket; }
  put(key, body, contentType) { return this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType })); }
  head(key) { return this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); }
  get(key) { return this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })); }
  delete(key) { return this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
}
