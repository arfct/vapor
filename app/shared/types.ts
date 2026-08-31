export interface UserInfo {
  name: string;
  color: string;
  colorLight: string;
  /** Monochrome animal glyph for anonymous users (rendered in Noto Emoji, tinted with `color`). */
  animal?: string;
  /** Stable identity key: the browser's anonymous uuid, or a principal after sign-in. */
  id?: string;
  /** Avatar image URL for a signed-in user (from Google), if any. */
  avatar?: string;
}

export type DocMode = "edit" | "suggest";

export interface ThreadReply {
  id: string;
  author: UserInfo;
  text: string;
  createdAt: number;
}

export interface ThreadData {
  id: string;
  commentText: string;
  highlightText?: string;
  author: UserInfo;
  createdAt: number;
  resolved: boolean;
  replies: ThreadReply[];
}

export interface CapturedSelection {
  from: number;
  to: number;
  text: string;
}
