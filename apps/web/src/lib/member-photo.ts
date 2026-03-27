const ASSEMBLY_MEMBER_PHOTO_PREFIX = "/static/portal/img/openassm/new/";
const ASSEMBLY_MEMBER_THUMB_PREFIX = `${ASSEMBLY_MEMBER_PHOTO_PREFIX}thumb/`;

export function getOptimizedMemberPhotoUrl(photoUrl?: string | null): string | null {
  if (!photoUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(photoUrl);

    if (parsedUrl.host !== "www.assembly.go.kr") {
      return photoUrl;
    }

    if (!parsedUrl.pathname.startsWith(ASSEMBLY_MEMBER_PHOTO_PREFIX)) {
      return photoUrl;
    }

    if (parsedUrl.pathname.startsWith(ASSEMBLY_MEMBER_THUMB_PREFIX)) {
      return photoUrl;
    }

    // The Assembly origin serves lightweight thumbnail variants under /new/thumb/.
    parsedUrl.pathname =
      `${ASSEMBLY_MEMBER_THUMB_PREFIX}${parsedUrl.pathname.slice(ASSEMBLY_MEMBER_PHOTO_PREFIX.length)}`;

    return parsedUrl.toString();
  } catch {
    return photoUrl;
  }
}
