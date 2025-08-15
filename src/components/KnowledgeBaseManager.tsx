import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download, RefreshCw, Database, Zap } from 'lucide-react';

interface Article {
  id: string;
  title: string;
  url: string;
  category: string;
  last_scraped_at: string;
  last_indexed_at: string;
  vector_id: string | null;
  created_at: string;
}

export const KnowledgeBaseManager = () => {
  const { toast } = useToast();
  const [articles, setArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [isVectorizing, setIsVectorizing] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    indexed: 0,
    pending: 0
  });

  useEffect(() => {
    loadArticles();
  }, []);

  const loadArticles = async () => {
    setIsLoading(true);
    try {
      // Get recent articles for display
      const { data: recentArticles, error: articlesError } = await supabase
        .from('kb_articles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (articlesError) {
        throw articlesError;
      }

      setArticles(recentArticles || []);
      
      // Get accurate stats for all articles
      const { data: totalStats, error: totalError } = await supabase
        .from('kb_articles')
        .select('id, content, vector_id');

      if (totalError) {
        throw totalError;
      }

      // Calculate accurate stats - only count articles with content as indexable
      const total = totalStats?.length || 0;
      const indexable = totalStats?.filter(article => article.content).length || 0;
      const indexed = totalStats?.filter(article => article.vector_id).length || 0;
      const pending = indexable - indexed;
      
      setStats({ total: indexable, indexed, pending });
    } catch (error) {
      console.error('Error loading articles:', error);
      toast({
        title: 'Error',
        description: 'Failed to load articles',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleScrape = async () => {
    setIsScraping(true);
    try {
      const { data, error } = await supabase.functions.invoke('scrape-knowledge-base');

      if (error) {
        throw error;
      }

      if (data.success) {
        toast({
          title: 'Scraping Started',
          description: `Processing ${data.total} articles. Job ID: ${data.jobId}. Auto-indexing will start after scraping.`,
        });
        
        // Auto-start vectorization after scraping completes
        const checkAndVectorize = async () => {
          try {
            // Wait for scraping to complete by checking job status
            const { data: jobData } = await supabase
              .from('scraping_jobs')
              .select('status, completed_at')
              .eq('id', data.jobId)
              .single();
            
            if (jobData?.status === 'completed' && jobData.completed_at) {
              toast({
                title: 'Scraping Complete',
                description: 'Starting automatic vectorization...',
              });
              
              // Start vectorization
              const { data: vectorData, error: vectorError } = await supabase.functions.invoke('vectorize-articles');
              
              if (vectorError) {
                console.error('Auto-vectorization failed:', vectorError);
                toast({
                  title: 'Auto-Vectorization Failed',
                  description: 'Please start vectorization manually.',
                  variant: 'destructive',
                });
              } else if (vectorData.success || vectorData.message) {
                toast({
                  title: 'Auto-Vectorization Started',
                  description: `Processing articles in background...`,
                });
              }
              
              loadArticles();
            } else if (jobData?.status === 'failed') {
              toast({
                title: 'Scraping Failed',
                description: 'Auto-vectorization skipped.',
                variant: 'destructive',
              });
            } else {
              // Still running, check again
              setTimeout(checkAndVectorize, 5000);
            }
          } catch (error) {
            console.error('Error checking job status:', error);
          }
        };
        
        // Start checking after initial delay
        setTimeout(checkAndVectorize, 10000);
        
        // Reload articles after a delay
        setTimeout(() => {
          loadArticles();
        }, 2000);
      } else {
        throw new Error(data.error || 'Scraping failed');
      }
    } catch (error) {
      console.error('Scraping error:', error);
      toast({
        title: 'Scraping Failed',
        description: error.message || 'Failed to start scraping',
        variant: 'destructive',
      });
    } finally {
      setIsScraping(false);
    }
  };

  const handleVectorize = async () => {
    setIsVectorizing(true);
    try {
      const { data, error } = await supabase.functions.invoke('vectorize-articles');

      if (error) {
        throw error;
      }

      if (data.success || data.message) {
        toast({
          title: 'Vectorization Response',
          description: data.message || `Processed ${data.processed || 0} articles, failed: ${data.failed || 0}`,
        });
        loadArticles();
      } else {
        throw new Error(data.error || 'Vectorization failed');
      }
    } catch (error) {
      console.error('Vectorization error:', error);
      toast({
        title: 'Vectorization Failed',
        description: error.message || 'Failed to vectorize articles',
        variant: 'destructive',
      });
    } finally {
      setIsVectorizing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center p-6">
            <Database className="h-8 w-8 text-primary mr-3" />
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Indexable Articles</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="flex items-center p-6">
            <Zap className="h-8 w-8 text-green-500 mr-3" />
            <div>
              <p className="text-2xl font-bold">{stats.indexed}</p>
              <p className="text-xs text-muted-foreground">Indexed Articles</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="flex items-center p-6">
            <RefreshCw className="h-8 w-8 text-orange-500 mr-3" />
            <div>
              <p className="text-2xl font-bold">{stats.pending}</p>
              <p className="text-xs text-muted-foreground">Pending Indexing</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Database Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Button 
              onClick={handleScrape} 
              disabled={isScraping}
              className="flex-1"
            >
              {isScraping ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {isScraping ? 'Scraping...' : 'Scrape Knowledge Base'}
            </Button>
            
            <Button 
              onClick={handleVectorize} 
              disabled={isVectorizing}
              variant="secondary"
              className="flex-1"
            >
              {isVectorizing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              {isVectorizing ? 'Vectorizing...' : 'Vectorize Articles'}
            </Button>
          </div>
          
          <Button 
            onClick={loadArticles} 
            disabled={isLoading}
            variant="outline"
            className="w-full"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh Data
          </Button>
        </CardContent>
      </Card>

      {/* Articles List */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Articles ({articles.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : articles.length > 0 ? (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {articles.map((article) => (
                <div 
                  key={article.id} 
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{article.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {article.category}
                      </Badge>
                      <Badge 
                        variant={article.vector_id ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {article.vector_id ? "Indexed" : "Pending"}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground ml-4">
                    {new Date(article.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No articles found. Start by scraping the knowledge base.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};