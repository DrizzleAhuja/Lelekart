import React, { useState, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { debounce } from '@/lib/utils';

interface SimplifiedSearchProps {
  className?: string;
}

export function SimplifiedSearch({ className = '' }: SimplifiedSearchProps) {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState('');
  const lastSubmittedQueryRef = useRef<string>('');

  // Use a debounce function to prevent rapid searches
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSetQuery = useCallback(
    debounce((value: string) => {
      setQuery(value);
    }, 300),
    []
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!query.trim()) return;
    
    // Normalize the query
    const normalizedQuery = query.trim();
    
    // Skip if it's the same as the last search we submitted
    if (normalizedQuery === lastSubmittedQueryRef.current) {
      console.log('SIMPLIFIED SEARCH - Skipping duplicate search:', normalizedQuery);
      return;
    }
    
    // Update the last search query
    lastSubmittedQueryRef.current = normalizedQuery;
    
    // Navigate to search results page with the exact query
    console.log('SIMPLIFIED SEARCH - Submitting new search:', normalizedQuery);
    setLocation(`/search?q=${encodeURIComponent(normalizedQuery)}`);
  };

  return (
    <form onSubmit={handleSubmit} className={`relative flex ${className}`}>
      <div className="relative flex-1">
        <Input
          type="text"
          placeholder="Searc for products, brands and more"
          className="w-full pr-10 pl-4 rounded-l-md border-r-0"
          onChange={(e) => debouncedSetQuery(e.target.value)}
          defaultValue={query}
        />
        <Button 
          type="submit" 
          className="absolute right-0 rounded-l-none"
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}