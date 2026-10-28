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
export type GroupVisibility = "public" | "private";
/** A group you belong to (P-35): its admin, or a member. */
export interface GroupSummary {
  id: string;
  name: string;
  role: "admin" | "member";
  visibility?: GroupVisibility;
}
/** One person in a group, as members see them. */
export interface GroupMember {
  profileId: string | null;
  name: string;
  title: { key: string; level: number } | null;
  role: "admin" | "member";
}
/** A request to join, as the admin sees it: only what helps decide. */
export interface GroupRequest {
  id: string;
  profileId: string | null;
  name: string;
  title: { key: string; level: number } | null;
  played: number;
  hosted: number;
  askedAt: string;
}
/**
 * A group page. A private group shows someone without a valid invite link
 * only that it is private.
 */
export type GroupView =
  | { id: string; visibility: "private"; concealed: true }
  | {
      id: string;
      name: string;
      visibility: GroupVisibility;
      viewerRole: "admin" | "member" | null;
      memberCount: number;
      canAsk: boolean;
      request: { id: string; state: "pending" | "declined" } | null;
      members?: GroupMember[];
      requests?: GroupRequest[];
      inviteToken?: string;
      invites?: SentInvite[];
      concealed?: undefined;
    };

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
/** P-38: an invite waiting for you, as Home shows it. */
export interface MyInvite {
  id: string;
  kind: "group" | "session";
  inviterName: string;
  sentAt: string;
  group: { id: string; name: string } | null;
  session: {
    slug: string;
    title: string;
    startsAt: string | null;
    timeZone: string;
  } | null;
}
/** Someone you can invite: people you already know through RallyPoint. */
export interface InviteCandidate {
  profileId: string;
  name: string;
  title: { key: string; level: number } | null;
}
/** An invite as its group's admin or its session's organizers see it. */
export interface SentInvite {
  id: string;
  name: string;
  state: "pending" | "accepted" | "declined" | "withdrawn";
  sentAt: string;
}
