import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Clock, Play, Pause, Settings, Zap } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

interface Schedule {
  id: string;
  schedule_name: string;
  last_run_at: string | null;
  next_run_at: string | null;
  articles_processed: number;
  articles_failed: number;
  status: string;
  created_at: string;
}

export const ScheduleManager = () => {
  const { toast } = useToast();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStartingBatch, setIsStartingBatch] = useState(false);

  useEffect(() => {
    loadSchedules();
  }, []);

  const loadSchedules = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('vectorization_schedules')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSchedules(data || []);
    } catch (error) {
      console.error('Error loading schedules:', error);
      toast({
        title: 'Eroare',
        description: 'Nu s-au putut încărca schedulurile',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartBatchVectorization = async () => {
    setIsStartingBatch(true);
    try {
      const { data, error } = await supabase.functions.invoke('vectorize-articles', {
        body: { 
          batch_size: 100, // Larger batch for complete processing
          force_all: true 
        }
      });

      if (error) throw error;

      if (data.success || data.message) {
        toast({
          title: 'Vectorizare Completă Începută',
          description: `Se procesează toate articolele nevectorizate...`,
        });
        loadSchedules();
      } else {
        throw new Error(data.error || 'Vectorizarea a eșuat');
      }
    } catch (error) {
      console.error('Batch vectorization error:', error);
      toast({
        title: 'Vectorizarea a Eșuat',
        description: error.message || 'Nu s-a putut începe vectorizarea',
        variant: 'destructive',
      });
    } finally {
      setIsStartingBatch(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="default" className="bg-green-500">Activ</Badge>;
      case 'running':
        return <Badge variant="secondary" className="bg-blue-500 text-white">Rulează</Badge>;
      case 'completed':
        return <Badge variant="outline">Completat</Badge>;
      case 'paused':
        return <Badge variant="secondary">Pauză</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Niciodată';
    return new Date(dateString).toLocaleString('ro-RO');
  };

  return (
    <div className="space-y-6">
      {/* Batch Vectorization */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Vectorizare Completă
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Vectorizează toate articolele nevectorizate dintr-o dată. Procesul va rula în background și se va continua automat până când toate articolele sunt procesate.
          </p>
          
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button 
                className="w-full"
                disabled={isStartingBatch}
              >
                {isStartingBatch ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                {isStartingBatch ? 'Se începe...' : 'Începe Vectorizarea Completă'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmare Vectorizare Completă</AlertDialogTitle>
                <AlertDialogDescription>
                  Aceasta va începe procesarea tuturor articolelor nevectorizate. Procesul va rula în background și poate dura mult timp în funcție de numărul de articole.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Anulează</AlertDialogCancel>
                <AlertDialogAction onClick={handleStartBatchVectorization}>
                  Începe Vectorizarea
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {/* Scheduled Tasks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Schedulare Automată
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : schedules.length > 0 ? (
            <div className="space-y-4">
              {schedules.map((schedule) => (
                <div 
                  key={schedule.id} 
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="font-medium">
                        {schedule.schedule_name === 'weekly-auto-vectorization' 
                          ? 'Vectorizare Săptămânală Automată' 
                          : schedule.schedule_name}
                      </h3>
                      {getStatusBadge(schedule.status)}
                    </div>
                    <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                      <p>Ultima rulare: {formatDate(schedule.last_run_at)}</p>
                      <p>Următoarea rulare: {formatDate(schedule.next_run_at)}</p>
                      {schedule.articles_processed > 0 && (
                        <p>Articole procesate: {schedule.articles_processed} | Eșuate: {schedule.articles_failed}</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Nu există schedule configurate.</p>
              <p className="text-sm">Schedularea automată săptămânală este configurată în database.</p>
            </div>
          )}
          
          <Button 
            onClick={loadSchedules} 
            disabled={isLoading}
            variant="outline"
            className="w-full mt-4"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Settings className="h-4 w-4 mr-2" />
            )}
            Reîmprospătează
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};