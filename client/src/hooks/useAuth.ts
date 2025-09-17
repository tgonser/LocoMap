// Authentication hook for Replit Auth - from blueprint javascript_log_in_with_replit
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface User {
  id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
}

export function useAuth() {
  const queryClient = useQueryClient();
  
  const { data: user, isLoading } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  const isAuthenticated = !!user;

  const logout = async () => {
    try {
      await fetch('/auth/logout', { method: 'POST' });
      queryClient.clear();
      window.location.href = '/';
    } catch (error) {
      console.error('Logout error:', error);
      // Force logout even if request fails
      queryClient.clear();
      window.location.href = '/';
    }
  };

  return {
    user: user as User | undefined,
    isLoading,
    isAuthenticated,
    logout,
  };
}