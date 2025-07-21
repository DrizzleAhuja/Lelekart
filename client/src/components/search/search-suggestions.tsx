import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useDebounce } from "../../hooks/use-debounce";
import { AISearchService } from "../../services/ai-search-service";

interface SearchSuggestion {
  id: number;
  name: string;
  image: string | null;
  price: number;
  category: string;
}

// Add helper function to process image URLs
const getProcessedImageUrl = (
  imageUrl: string | null,
  category: string
): string => {
  if (!imageUrl) return "/images/placeholder.svg";

  // If it's an external URL that needs proxy
  if (imageUrl.includes("flixcart.com") || imageUrl.includes("lelekart.com")) {
    return `/api/image-proxy?url=${encodeURIComponent(
      imageUrl
    )}&category=${encodeURIComponent(category || "")}`;
  }

  return imageUrl;
};

interface SearchSuggestionsProps {
  query: string;
  variant?: "default" | "admin";
  onSelect: (suggestion: SearchSuggestion) => void;
  onClose: () => void;
}

export function SearchSuggestions({
  query,
  variant = "default",
  onSelect,
  onClose,
}: SearchSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debouncedQuery = useDebounce(query, 300);

  // Fetch suggestions when the debounced query changes
  useEffect(() => {
    const fetchSuggestions = async () => {
      // Ensure we have a valid query with at least 2 characters
      if (!debouncedQuery || debouncedQuery.trim().length < 2) {
        setSuggestions([]);
        setError(null);
        return;
      }

      console.log(
        "SUGGESTION DEBUG - Starting fetch for suggestions with query:",
        debouncedQuery
      );

      // Store the current query to prevent race conditions
      const currentQuery = debouncedQuery.trim();

      setLoading(true);
      try {
        const isAdmin = variant === "admin";
        console.log(
          "SUGGESTION DEBUG - Calling AISearchService.getSuggestions with query:",
          currentQuery
        );

        const results = await AISearchService.getSuggestions(
          currentQuery,
          isAdmin
        );

        // Only update state if the query is still the same (prevent stale results)
        if (currentQuery === debouncedQuery.trim()) {
          console.log(
            `SUGGESTION DEBUG - Got ${results.length} suggestions for "${currentQuery}"`
          );
          setSuggestions(results);
          setError(null);
        } else {
          console.log(
            "SUGGESTION DEBUG - Query changed during fetch, discarding results"
          );
        }
      } catch (err) {
        console.error("Error fetching search suggestions:", err);

        // Only update state if the query is still the same
        if (currentQuery === debouncedQuery.trim()) {
          setError("Failed to fetch suggestions");
          setSuggestions([]);
        }
      } finally {
        // Only update loading state if the query is still the same
        if (currentQuery === debouncedQuery.trim()) {
          setLoading(false);
        }
      }
    };

    fetchSuggestions();
  }, [debouncedQuery, variant]);

  // Format currency for display
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(price);
  };

  // If there are no suggestions and no error, don't render anything
  if (!loading && suggestions.length === 0 && !error) {
    return null;
  }

  return (
    <div className="w-full bg-white rounded-md shadow-lg overflow-hidden border border-gray-200 z-50">
      {loading && (
        <div className="flex justify-center items-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {error && <div className="p-4 text-sm text-red-500">{error}</div>}

      {!loading && suggestions.length > 0 && (
        <ul className="max-h-80 overflow-y-auto">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <button
                type="button"
                className="w-full flex items-center px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // Add to browsing history (latest 5, no duplicates)
                  try {
                    const key = 'browsing_history_products';
                    let ids = [];
                    const existing = localStorage.getItem(key);
                    if (existing) {
                      ids = JSON.parse(existing);
                    }
                    ids = ids.filter((id) => id !== suggestion.id);
                    ids.unshift(suggestion.id);
                    if (ids.length > 5) ids = ids.slice(0, 5);
                    localStorage.setItem(key, JSON.stringify(ids));
                  } catch (err) {
                    // Ignore errors
                  }
                  // Add a small delay to ensure event handling is complete
                  setTimeout(() => {
                    onSelect(suggestion);
                  }, 10);
                }}
              >
                {suggestion.image && (
                  <div className="flex-shrink-0 h-12 w-12 mr-4 overflow-hidden rounded-md border border-gray-200">
                    <img
                      src={getProcessedImageUrl(
                        suggestion.image,
                        suggestion.category
                      )}
                      alt={suggestion.name}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        // Replace broken images with local placeholder
                        (e.target as HTMLImageElement).src =
                          "/images/placeholder.svg";
                      }}
                    />
                  </div>
                )}

                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {suggestion.name}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    in {suggestion.category}
                  </p>
                </div>

                <div className="flex-shrink-0 ml-2">
                  <p className="text-sm font-medium text-primary">
                    {formatPrice(suggestion.price)}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && suggestions.length > 0 && (
        <div className="bg-gray-50 p-2 text-xs text-gray-500 text-center border-t border-gray-200">
          Click on a suggestion or press Enter to search
        </div>
      )}
    </div>
  );
}
