import { authenticate, loadAuthenticatedUser } from "../middleware/auth.js";
import MediaUploadQuota from "../models/MediaUploadQuota.js";
import { createUploadQuota } from "../services/media/uploadQuota.js";
import MediaAsset from "../models/MediaAsset.js";
import { createS3Storage } from "../services/media/S3Storage.js";
import { createUploadSessionService } from "../services/media/uploadSession.js";
import { createAvatarRouter } from "../services/media/avatarRouter.js";
import UserDetail from "../models/UserDetailSchema.js";
import { createCompleteAvatarService } from "../services/media/completeAvatar.js";
import { createAvatarProfileService } from "../services/media/avatarProfile.js";

const storage = createS3Storage;

export default createAvatarRouter({
  authenticate,
  loadUser: loadAuthenticatedUser,
  createSession: (ownerId, input) => createUploadSessionService({
    assets: MediaAsset,
    storage: storage(),
    consumeQuota: createUploadQuota({ quotas: MediaUploadQuota }),
  })(ownerId, input),
  complete: (ownerId, mediaId) => createCompleteAvatarService({ assets: MediaAsset, users: UserDetail, storage: storage() })(ownerId, mediaId),
  getProfile: ownerId => createAvatarProfileService({ users: UserDetail, assets: MediaAsset, storage: storage() }).get(ownerId),
  remove: ownerId => createAvatarProfileService({ users: UserDetail, assets: MediaAsset, storage: storage() }).remove(ownerId),
});
