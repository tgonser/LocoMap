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
  };

  return {
    user: user as User | undefined,
    isLoading,
    isAuthenticated,
    logout,
  };
}