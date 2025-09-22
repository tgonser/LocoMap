// Simplified authentication hook to avoid React Hooks order violations
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface User {
  id: string;
  username?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  first_name?: string;  // Keep for backward compatibility
  last_name?: string;   // Keep for backward compatibility
  role?: string;
  isApproved?: boolean;
  approvalStatus?: string;
}

export function useAuth() {
  const queryClient = useQueryClient();
  
  const { data: user, isLoading } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  const isAuthenticated = !!user;

  const logout = () => {
    localStorage.removeItem('authToken');
    queryClient.clear();
    // Force page reload to return to login screen
    window.location.reload();
  };

  return {
    user: user as User | undefined,
    isLoading,
    isAuthenticated,
    logout,
  };
}