export interface PublicConfig {
  configured: boolean;
  auth: {
    url: string;
    publishableKey: string;
    google: boolean;
    localEmail: boolean;
  } | null;
}
export interface Identity {
  id: string;
  email: string;
  displayName: string;
}
export interface GroupSummary {
  id: string;
  name: string;
  role: "owner" | "organizer" | "cohost" | "member";
}
