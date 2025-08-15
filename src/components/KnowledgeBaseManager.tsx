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
        .select('id, last_indexed_at');

      if (totalError) {
        throw totalError;
      }

      // Calculate accurate stats
      const total = totalStats?.length || 0;
      const indexed = totalStats?.filter(article => article.last_indexed_at).length || 0;
      const pending = total - indexed;
      
      setStats({ total, indexed, pending });
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
          description: `Processing ${data.total} articles. Job ID: ${data.jobId}`,
        });
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
              <p className="text-xs text-muted-foreground">Total Articles</p>
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
                        variant={article.last_indexed_at ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {article.last_indexed_at ? "Indexed" : "Pending"}
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