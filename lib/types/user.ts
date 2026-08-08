export type Role = 'student' | 'teacher' | 'admin';

export type Strictness = 'supportive' | 'balanced' | 'independence' | 'assessment_safe';

export interface User {
  id: string;
  role: Role;
  displayName: string;
  preferredLanguage: 'vi' | 'en';
  createdAt: any; // Firestore Timestamp
  updatedAt: any;
  disabledAt?: any;
}

export interface AssistanceProfile {
  defaultStrictness: Strictness;
  accessibilitySettings: string[];
}

export interface StudentProfile {
  id: string;
  grade: number;
  subjects: string[];
  classroomIds: string[];
  assistanceProfile: AssistanceProfile;
  consentStatus: 'unknown' | 'granted' | 'declined';
  updatedAt?: any;
}

export interface TeacherProfile {
  id: string;
  classroomIds: string[];
  updatedAt?: any;
}
