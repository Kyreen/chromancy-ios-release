export type UserTier = 'free' | 'pay-as-you-use' | 'pro' | 'premium';

export interface BundleWallet {
  photo: number;
  video: number;
  design: number;
  business: number;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  tier: UserTier;
  createdAt?: string;
  unlockedProjects: string[];
  bundleWallet?: BundleWallet;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  type: 'design' | 'photo' | 'video' | 'business';
  originalUrl: string;
  enhancedUrl?: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, any>;
  isPremium: boolean;
  history?: string[];
}

export interface DesignCriticResult {
  score: number;
  hierarchy: string;
  contrast: string;
  balance: string;
  suggestions: string[];
}

export interface Tool {
  id: string;
  icon: any;
  label: string;
  description: string;
  instruction: string;
  isPremium: boolean;
  isVideo?: boolean;
}

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
    Capacitor?: any;
    __chromancyBillingReady?: boolean;
  }
}
