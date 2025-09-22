import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Users, CheckCircle, XCircle, Clock, Shield } from 'lucide-react';

interface PendingUser {
  id: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  approvalStatus: string;
  createdAt: string;
}

interface AdminStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  admins: number;
}

export default function AdminPanel() {
  const { toast } = useToast();
  const [processingUser, setProcessingUser] = useState<string | null>(null);

  // Fetch pending users
  const { data: pendingUsersData, isLoading: loadingUsers } = useQuery({
    queryKey: ['/api/admin/pending-users'],
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });

  // Fetch admin stats
  const { data: stats, isLoading: loadingStats } = useQuery<AdminStats>({
    queryKey: ['/api/admin/stats'],
    refetchInterval: 5000,
  });

  // Approval mutation
  const approvalMutation = useMutation({
    mutationFn: async ({ userId, action, reason }: { userId: string; action: 'approve' | 'reject'; reason?: string }) => {
      const response = await apiRequest('PATCH', `/api/admin/users/${userId}/approval`, {
        action,
        reason
      });
      return response.json();
    },
    onMutate: ({ userId }) => {
      setProcessingUser(userId);
    },
    onSuccess: (data, variables) => {
      toast({
        title: `User ${variables.action}d successfully`,
        description: `${data.user.email} has been ${variables.action}d.`,
      });
      // Refresh both queries
      queryClient.invalidateQueries({ queryKey: ['/api/admin/pending-users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stats'] });
    },
    onError: (error: any) => {
      toast({
        title: "Action failed",
        description: error?.message || "Failed to update user status",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setProcessingUser(null);
    }
  });

  const handleApprove = (userId: string) => {
    approvalMutation.mutate({ userId, action: 'approve' });
  };

  const handleReject = (userId: string) => {
    const reason = prompt("Optional: Reason for rejection (will be shown to user):");
    approvalMutation.mutate({ userId, action: 'reject', reason: reason || undefined });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const pendingUsers: PendingUser[] = pendingUsersData?.users || [];

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Admin Panel</h1>
            <p className="text-muted-foreground">Manage user access and approvals</p>
          </div>
        </div>

        {/* Stats Cards */}
        {!loadingStats && stats && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.total}</div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pending</CardTitle>
                <Clock className="h-4 w-4 text-yellow-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Approved</CardTitle>
                <CheckCircle className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{stats.approved}</div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Rejected</CardTitle>
                <XCircle className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{stats.rejected}</div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Admins</CardTitle>
                <Shield className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">{stats.admins}</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Pending Users */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Pending User Approvals
            </CardTitle>
            <CardDescription>
              Users waiting for account approval
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingUsers ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                <p className="text-muted-foreground">Loading pending users...</p>
              </div>
            ) : pendingUsers.length === 0 ? (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>No pending approvals</AlertTitle>
                <AlertDescription>
                  All users have been processed. New registration requests will appear here automatically.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-4">
                {pendingUsers.map((user) => (
                  <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg bg-card">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-semibold">
                          {user.firstName && user.lastName 
                            ? `${user.firstName} ${user.lastName}` 
                            : user.username}
                        </h3>
                        <Badge variant="secondary">{user.approvalStatus}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">
                        <strong>Email:</strong> {user.email}
                      </p>
                      <p className="text-sm text-muted-foreground mb-1">
                        <strong>Username:</strong> {user.username}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <strong>Requested:</strong> {formatDate(user.createdAt)}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleApprove(user.id)}
                        disabled={processingUser === user.id}
                        className="text-green-600 border-green-200 hover:bg-green-50"
                        data-testid={`button-approve-${user.id}`}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleReject(user.id)}
                        disabled={processingUser === user.id}
                        className="text-red-600 border-red-200 hover:bg-red-50"
                        data-testid={`button-reject-${user.id}`}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}