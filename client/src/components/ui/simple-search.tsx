import { Search, X, Mic } from 'lucide-react';
import { useState, FormEvent, useRef, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from './button';
import { VoiceSearchDialog } from '../../components/search/voice-search-dialog';
import { SearchSuggestions } from '../../components/search/search-suggestions';
import { cn } from '../../lib/utils';
import { AISearchService } from '../../services/ai-search-service';
import { useToast } from '../../hooks/use-toast';
import { useOnClickOutside } from '../../hooks/use-on-click-outside';
import { useAuth } from '../../hooks/use-auth';

interface SimpleSearchProps {
  className?: string;
  variant?: 'default' | 'admin' | 'dark';
}

export function SimpleSearch({ className, variant = 'default' }: SimpleSearchProps = {}) {
  const [query, setQuery] = useState('');
  const [isAiSearching, setIsAiSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [, navigate] = useLocation();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Close suggestions when clicking outside
  useOnClickOutside(formRef, () => {
    setShowSuggestions(false);
  });
  
  // Process search with AI
  const processAiSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    
    setIsAiSearching(true);
    
    try {
      // Always use the original query without modification
      // This ensures consistent behavior with voice search
      const processedQuery = searchQuery.trim();
      
      console.log('Processing AI search query:', processedQuery);
      
      // Process the query using AI to extract structured search parameters
      const result = await AISearchService.processQuery(processedQuery);
      
      if (result.success) {
        // Build a search URL from the extracted parameters
        const searchUrl = AISearchService.buildSearchUrl(result.filters, result.enhancedQuery);
        
        // Navigate to the search page using Wouter for SPA navigation
        console.log(`Navigating to AI search: ${searchUrl}`);
        navigate(searchUrl);
        
        toast({
          title: 'Search',
          description: `Searching for "${result.enhancedQuery}"`,
          duration: 3000
        });
      } else {
        throw new Error(result.error || 'Failed to process search query');
      }
    } catch (error) {
      console.error('Error processing AI search:', error);
      
      toast({
        title: 'Search Error',
        description: error instanceof Error ? error.message : 'Failed to process your search',
        variant: 'destructive'
      });
      
      // Fall back to simple search with the original query using Wouter navigation
      const fallbackUrl = `/search?q=${encodeURIComponent(searchQuery.trim())}`;
      console.log(`Falling back to simple search: ${fallbackUrl}`);
      navigate(fallbackUrl);
    } finally {
      setIsAiSearching(false);
    }
  };

  // Handle form submission
  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      console.log('Search for:', query);
      setShowSuggestions(false);
      
      // For admin layout search
      if (variant === 'admin') {
        // Admin search navigation
        toast({
          title: 'Admin Search',
          description: `Searching admin products for "${query.trim()}"`,
          duration: 3000
        });
        
        // Use Wouter navigation for admin search
        const searchUrl = `/admin/products?search=${encodeURIComponent(query.trim())}`;
        console.log(`Navigating to admin search: ${searchUrl}`);
        navigate(searchUrl);
      } else {
        // Regular user search navigation
        toast({
          title: 'Search',
          description: `Searching for "${query.trim()}"`,
          duration: 3000
        });
        
        // Use navigate from wouter for SPA navigation
        const searchUrl = `/search?q=${encodeURIComponent(query.trim())}`;
        console.log(`Navigating to regular search: ${searchUrl}`);
        navigate(searchUrl);
      }
    }
  };
  
  // Handle voice search query
  const handleVoiceSearch = async (voiceQuery: string) => {
    if (!voiceQuery.trim()) return;
    
    console.log('Processing voice search query:', voiceQuery);
    
    // For admin layout voice search
    if (variant === 'admin') {
      // Admin voice search navigation
      toast({
        title: 'Admin Voice Search',
        description: `Searching admin products for "${voiceQuery.trim()}"`,
        duration: 3000
      });
      
      // Use Wouter navigation for admin voice search
      const searchUrl = `/admin/products?search=${encodeURIComponent(voiceQuery.trim())}`;
      console.log(`Navigating to admin voice search: ${searchUrl}`);
      navigate(searchUrl);
    } else {
      // Regular voice search navigation
      toast({
        title: 'Voice Search',
        description: `Searching for "${voiceQuery.trim()}"`,
        duration: 3000
      });
      
      // Use navigate from wouter for SPA navigation
      const searchUrl = `/search?q=${encodeURIComponent(voiceQuery.trim())}`;
      console.log(`Navigating to regular voice search: ${searchUrl}`);
      navigate(searchUrl);
      
      // Temporarily disabled until we resolve API issues
      // await processAiSearch(voiceQuery);
    }
  };

  const clearSearch = () => setQuery('');

  // Focus input when pressing / key
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, []);

  // (Removed old const declarations; using let declarations above)
  
  return (
    <div className={cn("relative", className)}>
      <form ref={formRef} onSubmit={handleSearch} className="relative w-full max-w-xl">
        <div className={`flex items-center border-2 border-gray-200 hover:border-gray-400 focus-within:border-primary rounded-lg px-4 py-2.5 bg-gradient-to-r from-[#f5e7d4] via-[#fff8f1] to-[#f5e7d4] shadow transition-all`}>
          <Search className="h-5 w-5 mr-3 text-black" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder={variant === 'admin' ? "Search for products..." : "Search for products, brands and more..."}
            className="flex-1 outline-none bg-transparent text-black placeholder:text-black text-base"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // Only show suggestions when query has at least 2 characters
              if (e.target.value.trim().length >= 2) {
                setShowSuggestions(true);
              } else {
                setShowSuggestions(false);
              }
            }}
            onFocus={() => {
              // Only show suggestions when query has at least 2 characters
              if (query.trim().length >= 2) {
                setShowSuggestions(true);
              }
            }}
            disabled={isAiSearching}
          />
          {query && (
            <button 
              type="button"
              className="text-white/80 hover:text-white"
              onClick={clearSearch}
              disabled={isAiSearching}
              title="Clear search"
            >
              <X className="h-5 w-5" />
            </button>
          )}
          
          {/* Voice search button */}
          <VoiceSearchDialog 
            className="ml-2 text-black hover:text-black"
            buttonVariant="ghost"
            buttonSize="icon"
            buttonText=""
            showIcon={true}
            onSearch={handleVoiceSearch}
          />
          
          <Button 
            type="submit" 
            className="ml-3 bg-primary text-white hover:bg-primary/90 font-medium rounded-md"
            size="sm"
            disabled={isAiSearching}
            title="Search"
          >
            Search
          </Button>
        </div>
        
        {/* Search suggestions dropdown */}
        {showSuggestions && query.trim().length >= 2 && (
          <div className="absolute w-full mt-1 z-50">
            <SearchSuggestions 
              query={query} 
              variant={variant}
              onSelect={(suggestion) => {
                console.log('Search suggestion selected:', suggestion);
                
                // Clear query after selection
                setQuery('');
                setShowSuggestions(false);
                
                // Use different paths based on variant
                if (variant === 'admin') {
                  // Admin path navigation - use Wouter navigation
                  console.log(`Navigating to admin product: /admin/products/${suggestion.id}`);
                  navigate(`/admin/products/${suggestion.id}`);
                } else {
                  // Customer path navigation - using Wouter navigation
                  console.log(`Navigating to product: /product/${suggestion.id}`);
                  navigate(`/product/${suggestion.id}`);
                }
              }}
              onClose={() => setShowSuggestions(false)}
            />
          </div>
        )}
        
        {/* Removed keyboard hint text */}
      </form>
    </div>
  );
}