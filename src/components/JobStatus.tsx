import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, CheckCircle, XCircle, Clock, Trash2 } from 'lucide-react';

interface ScrapingJob {
  id: string;
  status: string;
  total_urls: number;
  processed_urls: number;
  failed_urls: number;
  error_message: string;
  started_at: string;
  completed_at: string;
  created_at: string;
}

export const JobStatus = () => {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<ScrapingJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadJobs();
    
    // Set up real-time subscription for job updates
    const subscription = supabase
      .channel('scraping_jobs')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'scraping_jobs'
        },
        () => {
          loadJobs();
        }
      )
      .subscribe();

    // Poll for updates every 5 seconds for running jobs
    const interval = setInterval(() => {
      loadJobs();
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const loadJobs = async () => {
    try {
      const { data, error } = await supabase
        .from('scraping_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        throw error;
      }

      setJobs(data || []);
    } catch (error) {
      console.error('Error loading jobs:', error);
      toast({
        title: 'Error',
        description: 'Failed to load job status',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4" />;
      case 'running':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      pending: 'secondary',
      running: 'default',
      completed: 'default',
      failed: 'destructive'
    } as const;

    return (
      <Badge variant={variants[status as keyof typeof variants] || 'secondary'}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const calculateProgress = (job: ScrapingJob) => {
    if (job.total_urls === 0) return 0;
    return Math.round((job.processed_urls / job.total_urls) * 100);
  };

  const formatDuration = (startDate: string, endDate?: string) => {
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date();
    const duration = Math.round((end.getTime() - start.getTime()) / 1000);
    
    if (duration < 60) return `${duration}s`;
    if (duration < 3600) return `${Math.round(duration / 60)}m`;
    return `${Math.round(duration / 3600)}h`;
  };

  const handleDelete = async (jobId: string) => {
    try {
      const { error } = await supabase
        .from('scraping_jobs')
        .delete()
        .eq('id', jobId);
      if (error) throw error;
      toast({ title: 'Job deleted', description: `Job ${jobId.slice(0,8)} removed` });
      loadJobs();
    } catch (err: any) {
      console.error('Failed to delete job:', err);
      toast({ title: 'Delete failed', description: err.message || 'Could not delete job', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Scraping Jobs Status</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length > 0 ? (
            <div className="space-y-4">
              {jobs.map((job) => (
                <div key={job.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.status)}
                      <span className="font-medium">Job {job.id.slice(0, 8)}</span>
                      {getStatusBadge(job.status)}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>{new Date(job.created_at).toLocaleString()}</span>
                      {job.status === 'completed' && (
                        <Button variant="outline" size="sm" onClick={() => handleDelete(job.id)}>
                          <Trash2 className="h-4 w-4 mr-1" /> Delete
                        </Button>
                      )}
                    </div>
                  </div>

                  {job.total_urls > 0 && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Progress</span>
                        <span>{job.processed_urls} / {job.total_urls} articles</span>
                      </div>
                      <Progress value={calculateProgress(job)} className="h-2" />
                    </div>
                  )}

                  <div className="flex justify-between text-sm text-muted-foreground">
                    <div className="space-x-4">
                      {job.processed_urls > 0 && (
                        <span>✅ {job.processed_urls} processed</span>
                      )}
                      {job.failed_urls > 0 && (
                        <span>❌ {job.failed_urls} failed</span>
                      )}
                    </div>
                    <div>
                      {job.started_at && (
                        <span>
                          Duration: {formatDuration(job.started_at, job.completed_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  {job.error_message && (
                    <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/20 p-2 rounded">
                      Error: {job.error_message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No scraping jobs found. Start a scraping job from the Manage Database tab.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};