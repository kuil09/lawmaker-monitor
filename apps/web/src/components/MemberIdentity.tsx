import { formatMemberAffiliation } from "../lib/member-affiliation.js";
import { getOptimizedMemberPhotoUrl } from "../lib/member-photo.js";

type MemberIdentityProps = {
  name: string;
  party?: string | null;
  district?: string | null;
  photoUrl?: string | null;
  calendarHref?: string | null;
  size?: "small" | "medium" | "large";
  showParty?: boolean;
  avatarVariant?: "default" | "activity-card";
};

export function MemberIdentity({
  name,
  party,
  district,
  photoUrl,
  calendarHref,
  size = "medium",
  showParty = true,
  avatarVariant = "default"
}: MemberIdentityProps) {
  const resolvedPhotoUrl = getOptimizedMemberPhotoUrl(photoUrl);
  const variantClassName =
    avatarVariant === "activity-card" ? "member-identity--activity-card" : "";
  const avatarClassName =
    avatarVariant === "activity-card"
      ? "member-identity__avatar member-identity__avatar--activity-card"
      : "member-identity__avatar";
  const fallbackAvatarClassName =
    avatarVariant === "activity-card"
      ? "member-identity__avatar member-identity__avatar--fallback member-identity__avatar--activity-card"
      : "member-identity__avatar member-identity__avatar--fallback";

  const identityBody = (
    <>
      {resolvedPhotoUrl ? (
        <img
          className={avatarClassName}
          src={resolvedPhotoUrl}
          alt=""
          loading="lazy"
        />
      ) : (
        <span className={fallbackAvatarClassName} aria-hidden="true">
          {name.slice(0, 1)}
        </span>
      )}
      <div className="member-identity__text">
        <span className="member-identity__name">{name}</span>
        {showParty && (party || district !== undefined) ? (
          <span className="member-identity__party">
            {formatMemberAffiliation(party, district)}
          </span>
        ) : null}
      </div>
    </>
  );

  return (
    <div
      className={`member-identity member-identity--${size} ${variantClassName}`.trim()}
    >
      {calendarHref ? (
        <a href={calendarHref} className="member-identity__primary">
          {identityBody}
        </a>
      ) : (
        identityBody
      )}
    </div>
  );
}
