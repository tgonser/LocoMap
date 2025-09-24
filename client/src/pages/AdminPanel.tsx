import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Users, CheckCircle, XCircle, Clock, Shield, UserMinus, BarChart3, Eye } from 'lucide-react';

interface PendingUser {
  id: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  approvalStatus: string;
  createdAt: string;
}

interface ApprovedUser {
  id: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  approvalStatus: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  role: string;
}

interface AdminStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  admins: number;
}

interface VisitorStats {
  totalVisits: number;
  uniqueVisitors: number;
  period: string;
  recentVisits: Array<{
    date: string;
    visits: number;
    uniqueVisitors: number;
  }>;
  topPages: Array<{
    path: string;
    visits: number;
    uniqueVisitors: number;
  }>;
}

export default function AdminPanel() {
  const { toast } = useToast();
  const [processingUser, setProcessingUser] = useState<string | null>(null);

  // Fetch pending users
  const { data: pendingUsersData, isLoading: loadingUsers } = useQuery({
    queryKey: ['/api/admin/pending-users'],
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });

  // Fetch approved users
  const { data: approvedUsersData, isLoading: loadingApprovedUsers } = useQuery({
    queryKey: ['/api/admin/approved-users'],
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });

  // Fetch admin stats
  const { data: stats, isLoading: loadingStats } = useQuery<AdminStats>({
    queryKey: ['/api/admin/stats'],
    refetchInterval: 5000,
  });

  // Fetch visitor stats
  const { data: visitorStats, isLoading: loadingVisitorStats } = useQuery<VisitorStats>({
    queryKey: ['/api/admin/visitor-stats'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Approval mutation (now supports revoke)
  const approvalMutation = useMutation({
    mutationFn: async ({ userId, action, reason }: { userId: string; action: 'approve' | 'reject' | 'revoke'; reason?: string }) => {
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
      // Refresh all admin queries
      queryClient.invalidateQueries({ queryKey: ['/api/admin/pending-users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/approved-users'] });
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

  const handleRevoke = (userId: string, userEmail: string) => {
    const confirmed = confirm(`Are you sure you want to revoke access for ${userEmail}? This will immediately block their access to the application.`);
    if (confirmed) {
      const reason = prompt("Optional: Reason for revoking access:");
      approvalMutation.mutate({ userId, action: 'revoke', reason: reason || undefined });
    }
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
  const approvedUsers: ApprovedUser[] = approvedUsersData?.users || [];

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

        {/* User Management Tabs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              User Management
            </CardTitle>
            <CardDescription>
              Manage pending approvals and approved user access
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="pending" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="pending" data-testid="tab-pending-users">
                  <Clock className="h-4 w-4 mr-1" />
                  Pending ({pendingUsers.length})
                </TabsTrigger>
                <TabsTrigger value="approved" data-testid="tab-approved-users">
                  <CheckCircle className="h-4 w-4 mr-1" />
                  Approved ({approvedUsers.length})
                </TabsTrigger>
                <TabsTrigger value="analytics" data-testid="tab-analytics">
                  <BarChart3 className="h-4 w-4 mr-1" />
                  Analytics
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="pending" className="mt-6">
                {loadingUsers ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading pending users...</p>
                  </div>
                ) : pendingUsers.length === 0 ? (
                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>No pending approvals</strong><br />
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
              </TabsContent>
              
              <TabsContent value="approved" className="mt-6">
                {loadingApprovedUsers ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading approved users...</p>
                  </div>
                ) : approvedUsers.length === 0 ? (
                  <Alert>
                    <Users className="h-4 w-4" />
                    <AlertDescription>
                      <strong>No approved users</strong><br />
                      Once you approve pending users, they will appear here for management.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-4">
                    {approvedUsers.map((user) => (
                      <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg bg-card">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="font-semibold">
                              {user.firstName && user.lastName 
                                ? `${user.firstName} ${user.lastName}` 
                                : user.username}
                            </h3>
                            <Badge variant="outline" className="text-green-600 border-green-200">
                              {user.role === 'admin' ? 'Admin' : 'Approved'}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-1">
                            <strong>Email:</strong> {user.email}
                          </p>
                          <p className="text-sm text-muted-foreground mb-1">
                            <strong>Username:</strong> {user.username}
                          </p>
                          <p className="text-sm text-muted-foreground mb-1">
                            <strong>Approved:</strong> {user.approvedAt ? formatDate(user.approvedAt) : 'N/A'}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            <strong>Member since:</strong> {formatDate(user.createdAt)}
                          </p>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {user.role !== 'admin' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRevoke(user.id, user.email)}
                              disabled={processingUser === user.id}
                              className="text-orange-600 border-orange-200 hover:bg-orange-50"
                              data-testid={`button-revoke-${user.id}`}
                            >
                              <UserMinus className="h-4 w-4 mr-1" />
                              Revoke Access
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Analytics Tab */}
              <TabsContent value="analytics" className="mt-6">
                {loadingVisitorStats ? (
                  <div className="text-center py-8">
                    <div className="text-muted-foreground">Loading visitor statistics...</div>
                  </div>
                ) : visitorStats ? (
                  <div className="space-y-6">
                    {/* Visitor Overview Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">Total Visits</CardTitle>
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold">{visitorStats.totalVisits}</div>
                          <p className="text-xs text-muted-foreground">
                            Last {visitorStats.period}
                          </p>
                        </CardContent>
                      </Card>
                      
                      <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">Unique Visitors</CardTitle>
                          <Users className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold">{visitorStats.uniqueVisitors}</div>
                          <p className="text-xs text-muted-foreground">
                            Distinct IP addresses
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Top Pages */}
                    {visitorStats.topPages && visitorStats.topPages.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle>Most Visited Pages</CardTitle>
                          <CardDescription>Popular pages on your website</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {visitorStats.topPages.slice(0, 5).map((page, index) => (
                              <div key={page.path} className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                                    {index + 1}
                                  </div>
                                  <div>
                                    <div className="font-medium text-sm">{page.path}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {page.uniqueVisitors} unique visitors
                                    </div>
                                  </div>
                                </div>
                                <Badge variant="secondary">{page.visits} visits</Badge>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Recent Activity */}
                    {visitorStats.recentVisits && visitorStats.recentVisits.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle>Recent Activity</CardTitle>
                          <CardDescription>Daily visitor trends</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {visitorStats.recentVisits.slice(0, 7).map((day) => (
                              <div key={day.date} className="flex items-center justify-between py-2">
                                <div className="text-sm font-medium">
                                  {new Date(day.date).toLocaleDateString()}
                                </div>
                                <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                                  <span>{day.visits} visits</span>
                                  <span>{day.uniqueVisitors} unique</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="text-muted-foreground">No visitor data available</div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}