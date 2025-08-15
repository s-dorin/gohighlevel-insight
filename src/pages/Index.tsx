import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { KnowledgeBaseManager } from '@/components/KnowledgeBaseManager';
import { ArticleSearch } from '@/components/ArticleSearch';
import { JobStatus } from '@/components/JobStatus';
import { ScheduleManager } from '@/components/ScheduleManager';

const Index = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('search');

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-4 text-foreground">
            HighLevel Knowledge Base Manager
          </h1>
          <p className="text-xl text-muted-foreground">
            Scrape, process și search în baza de cunoștințe HighLevel
          </p>
        </div>

        <div className="flex justify-center mb-8">
          <div className="flex space-x-4 bg-card p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('search')}
              className={`px-4 py-2 rounded-md transition-colors ${
                activeTab === 'search'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Search Articles
            </button>
            <button
              onClick={() => setActiveTab('manage')}
              className={`px-4 py-2 rounded-md transition-colors ${
                activeTab === 'manage'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Manage Database
            </button>
            <button
              onClick={() => setActiveTab('schedule')}
              className={`px-4 py-2 rounded-md transition-colors ${
                activeTab === 'schedule'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Auto Schedule
            </button>
            <button
              onClick={() => setActiveTab('status')}
              className={`px-4 py-2 rounded-md transition-colors ${
                activeTab === 'status'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Job Status
            </button>
          </div>
        </div>

        <div className="max-w-6xl mx-auto">
          {activeTab === 'search' && <ArticleSearch />}
          {activeTab === 'manage' && <KnowledgeBaseManager />}
          {activeTab === 'schedule' && <ScheduleManager />}
          {activeTab === 'status' && <JobStatus />}
        </div>
      </div>
    </div>
  );
};

export default Index;
