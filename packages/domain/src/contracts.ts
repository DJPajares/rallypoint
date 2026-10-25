export interface PublicConfig {
  configured: boolean;
  auth: {
    url: string;
    publishableKey: string;
    google: boolean;
    password: boolean;
    localEmail: boolean;
  } | null;
}
export interface Identity {
  id: string;
  email: string;
  displayName: string;
  profileId: string;
}
export interface GroupSummary {
  id: string;
  name: string;
  role: "owner" | "organizer" | "cohost" | "member";
}

export interface CohostPerson {
  profileId: string;
  name: string;
}

export interface GroupCohosts {
  group: GroupSummary;
  revision: string;
  assigned: CohostPerson[];
  candidates: CohostPerson[];
  nextCursor: string | null;
}
