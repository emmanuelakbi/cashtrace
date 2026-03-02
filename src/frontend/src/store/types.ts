export interface User {
  id: string;
  email: string;
  businessId: string;
  businessName: string;
}

export interface Business {
  id: string;
  name: string;
  sector?: string;
}

export interface PendingAction {
  id: string;
  type: 'create' | 'update' | 'delete';
  resource: string;
  data: unknown;
  createdAt: Date;
  retryCount: number;
}

export interface GlobalStore {
  // User state
  user: User | null;
  setUser: (user: User | null) => void;

  // Business context
  activeBusiness: Business | null;
  setActiveBusiness: (business: Business | null) => void;

  // UI preferences
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;

  // Notifications
  unreadCount: number;
  setUnreadCount: (count: number) => void;

  // Offline state
  isOnline: boolean;
  setIsOnline: (online: boolean) => void;
  pendingActions: PendingAction[];
  addPendingAction: (action: PendingAction) => void;
  clearPendingActions: () => void;

  // Logout
  clearSensitiveState: () => void;
}
