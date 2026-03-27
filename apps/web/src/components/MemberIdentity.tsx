type MemberIdentityProps = {
  name: string;
  party?: string | null;
  photoUrl?: string | null;
  calendarHref?: string | null;
  size?: "small" | "medium" | "large";
  showParty?: boolean;
};

export function MemberIdentity({
  name,
  party,
  photoUrl,
  calendarHref,
  size = "medium",
  showParty = true
}: MemberIdentityProps) {
  const identityBody = (
    <>
      {photoUrl ? (
        <img className="member-identity__avatar" src={photoUrl} alt="" loading="lazy" />
      ) : (
        <span className="member-identity__avatar member-identity__avatar--fallback" aria-hidden="true">
          {name.slice(0, 1)}
        </span>
      )}
      <div className="member-identity__text">
        <span className="member-identity__name">{name}</span>
        {showParty && party ? <span className="member-identity__party">{party}</span> : null}
      </div>
    </>
  );

  return (
    <div className={`member-identity member-identity--${size}`}>
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
