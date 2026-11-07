import { authenticate, loadAuthenticatedUser } from "../middleware/auth.js";
import MediaUploadQuota from "../models/MediaUploadQuota.js";
import { createUploadQuota } from "../services/media/uploadQuota.js";
import MediaAsset from "../models/MediaAsset.js";
import { createS3Storage } from "../services/media/S3Storage.js";
import { createUploadSessionService } from "../services/media/uploadSession.js";
import { createAvatarRouter } from "../services/media/avatarRouter.js";

export default createAvatarRouter({
  authenticate,
  loadUser: loadAuthenticatedUser,
  createSession: (ownerId, input) => createUploadSessionService({
    assets: MediaAsset,
    storage: createS3Storage(),
    consumeQuota: createUploadQuota({ quotas: MediaUploadQuota }),
  })(ownerId, input),
});
