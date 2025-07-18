import { useState, useRef, useEffect } from 'react';
import { Search, X, TrendingUp, History } from 'lucide-react';
import { useOnClickOutside } from '@/hooks/use-on-click-outside';
import { useDebounce } from '@/hooks/use-debounce';

interface SearchSuggestion {
  id: number;
  name: string;
  image: string | null;
  price: number;
  category: string;
}

interface FlipkartSearchProps {
  className?: string;
}

export function FlipkartSearch({ className = "" }: FlipkartSearchProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(query, 300);
  
  // Local storage key for recent searches
  const RECENT_SEARCHES_KEY = 'lelekart_recent_searches';
  
  // Get recent searches from local storage
  const getRecentSearches = (): string[] => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Error retrieving recent searches:', error);
    }
    return [];
  };
  
  // Save a search term to recent searches
  const saveToRecentSearches = (searchTerm: string) => {
    try {
      const recentSearches = getRecentSearches();
      // Remove if already exists and add to the beginning
      const updated = [
        searchTerm, 
        ...recentSearches.filter(term => term !== searchTerm)
      ].slice(0, 5); // Keep only the most recent 5 searches
      
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch (error) {
      console.error('Error saving recent search:', error);
    }
  };

  // Close suggestions when clicking outside
  useOnClickOutside(searchRef, () => {
    setShowSuggestions(false);
  });

  // Fetch suggestions when query changes
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!debouncedQuery || debouncedQuery.trim().length < 2) {
        setSuggestions([]);
        return;
      }

      setIsLoading(true);
      try {
        const url = `/api/lelekart-search?q=${encodeURIComponent(debouncedQuery)}&limit=6`;
        console.log(`Fetching search suggestions from: ${url}`);
        
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error('Failed to fetch search suggestions');
        }
        
        const data = await response.json();
        console.log(`Found ${data.length} search suggestions`);
        
        // Process the suggestions to ensure proper image handling
        const processedSuggestions = data.map((item: any) => {
          let imageUrl = null;
          
          // Handle different image formats from the API
          if (item.imageUrl) {
            imageUrl = item.imageUrl;
          } else if (item.images) {
            try {
              // Try to parse the images if it's a JSON string
              const imagesArray = typeof item.images === 'string' ? JSON.parse(item.images) : item.images;
              if (Array.isArray(imagesArray) && imagesArray.length > 0) {
                imageUrl = imagesArray[0];
              }
            } catch (err) {
              console.error('Error parsing product images:', err);
            }
          }
          
          return {
            id: item.id,
            name: item.name,
            image: imageUrl,
            price: item.price || 0,
            category: item.category || 'Uncategorized'
          };
        });
        
        setSuggestions(processedSuggestions);
      } catch (error) {
        console.error('Error fetching search suggestions:', error);
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSuggestions();
  }, [debouncedQuery]);

  // Handle form submission
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (query.trim()) {
      console.log('Search for:', query);
      setShowSuggestions(false);
      
      // Save to recent searches
      saveToRecentSearches(query.trim());
      
      // Navigate to search results page
      // Use 'replace' to ensure the URL is properly encoded and handled
      window.location.replace(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };
  
  // Handle clicking on a recent search
  const handleRecentSearchClick = (searchTerm: string) => {
    setQuery(searchTerm);
    setShowSuggestions(false);
    
    // Save to recent searches to bring it to the top
    saveToRecentSearches(searchTerm);
    
    // Navigate to search results page
    // Use 'replace' instead of 'href' to ensure the URL is properly encoded and handled
    window.location.replace(`/search?q=${encodeURIComponent(searchTerm)}`);
  };

  // Format price as Indian Rupees
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(price);
  };

  const clearSearch = () => {
    setQuery('');
    setSuggestions([]);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };
  
  // Trending searches - these would typically come from an API
  // but for now we'll hardcode some example trending searches
  const trendingSearches = [
    'Smartphones',
    'Laptops',
    'Headphones',
    'Smart Watches',
    'Cameras'
  ];

  return (
    <div ref={searchRef} className={`relative ${className}`}>
      <form onSubmit={handleSearch} className="flex items-center">
        <div className="relative flex-grow">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim().length >= 2) {
                setShowSuggestions(true);
              } else {
                setShowSuggestions(true); // Always show suggestions (recent/trending)
              }
            }}
            onFocus={() => {
              setShowSuggestions(true); // Always show suggestions on focus
            }}
            placeholder="Searc for products, brands and more"
            className="w-full h-10 pl-4 pr-10 rounded-l-sm border-2 border-primary focus:outline-none text-gray-800"
            aria-label="Search"
          />
          {query && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
              aria-label="Clear search"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <button
          type="submit"
          className="h-10 px-4 bg-primary text-white rounded-r-sm hover:bg-primary/90 focus:outline-none flex items-center justify-center"
          aria-label="Search button"
        >
          <Search className="h-5 w-5" />
        </button>
      </form>

      {/* Search suggestions dropdown */}
      {showSuggestions && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white rounded shadow-lg border border-gray-200">
          {/* Loading indicator */}
          {isLoading && (
            <div className="p-4 flex justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          )}
          
          {/* Product suggestions */}
          {!isLoading && suggestions.length > 0 && (
            <div>
              <div className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-200">
                PRODUCTS
              </div>
              <ul className="max-h-72 overflow-y-auto">
                {suggestions.map((suggestion) => (
                  <li key={suggestion.id}>
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center"
                      onClick={() => {
                        setShowSuggestions(false);
                        setQuery('');
                        
                        // Always navigate to the public product details page
                        console.log(`Navigating to product: /product/${suggestion.id}`);
                        window.location.href = `/product/${suggestion.id}`;
                      }}
                    >
                      {suggestion.image && (
                        <div className="h-12 w-12 flex-shrink-0 mr-3 overflow-hidden border border-gray-200 rounded">
                          <img
                            src={suggestion.image}
                            alt={suggestion.name}
                            className="h-full w-full object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = "/images/placeholder.svg";
                            }}
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{suggestion.name}</p>
                        <p className="text-xs text-gray-500">in {suggestion.category}</p>
                      </div>
                      <div className="ml-3">
                        <p className="text-sm font-medium text-primary">{formatPrice(suggestion.price)}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="p-2 border-t border-gray-200">
                <button
                  className="w-full text-center text-primary text-sm font-medium py-1 hover:bg-gray-50 rounded"
                  onClick={(e) => {
                    e.preventDefault();
                    // Use window.location.replace for consistent navigation
                    window.location.replace(`/search?q=${encodeURIComponent(query.trim())}`);
                  }}
                >
                  View all results for "{query}"
                </button>
              </div>
            </div>
          )}
          
          {/* Recent searches - shown when no query or short query */}
          {!isLoading && suggestions.length === 0 && getRecentSearches().length > 0 && (
            <div>
              <div className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-200 flex items-center">
                <History className="h-3 w-3 mr-1" /> RECENT SEARCHES
              </div>
              <ul className="py-1">
                {getRecentSearches().map((term, index) => (
                  <li key={`recent-${index}`}>
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center"
                      onClick={() => handleRecentSearchClick(term)}
                    >
                      <Search className="h-4 w-4 mr-2 text-gray-400" />
                      <span className="text-sm text-gray-700">{term}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Trending searches - shown when no query or short query and no recent searches */}
          {!isLoading && suggestions.length === 0 && (
            <div>
              <div className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-200 flex items-center">
                <TrendingUp className="h-3 w-3 mr-1" /> TRENDING
              </div>
              <ul className="py-1">
                {trendingSearches.map((term, index) => (
                  <li key={`trending-${index}`}>
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center"
                      onClick={() => {
                        setQuery(term);
                        // Use window.location.replace for consistent navigation
                        window.location.replace(`/search?q=${encodeURIComponent(term.trim())}`);
                      }}
                    >
                      <TrendingUp className="h-4 w-4 mr-2 text-gray-400" />
                      <span className="text-sm text-gray-700">{term}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}