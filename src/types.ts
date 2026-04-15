export type NoteType = 'text' | 'todo' | 'voice';

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface Note {
  id: string;
  ownerId: string;
  collaborators?: string[];
  title: string;
  content: string;
  category: string;
  tags: string[];
  isPinned: boolean;
  isPrivate: boolean;
  isPublic: boolean;
  isArchived?: boolean;
  isDeleted?: boolean;
  color?: string;
  type: NoteType;
  images?: string[];
  checklist?: ChecklistItem[];
  voiceUrl?: string;
  reminderAt?: string;
  reminderNotified?: boolean;
  notePassword?: string;
  createdAt: any;
  updatedAt: any;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  settings: {
    darkMode: boolean;
    lockEnabled: boolean;
    lockPassword?: string;
  };
  status: 'active' | 'banned';
  role: 'admin' | 'user';
  createdAt: any;
}
