import { createFileRoute } from "@tanstack/react-router";
import { CataloguePage } from "../../../features/library";

interface CatalogueSearch {
  title?: string;
  /** Show only this author's books (opened from Shelves and rules → Authors). */
  author?: string;
}

/** /library/catalogue?title=<id>&author=<name> — titles and copies; the title opens in a side panel. */
export const Route = createFileRoute("/_app/library/catalogue")({
  validateSearch: (s: Record<string, unknown>): CatalogueSearch => ({
    ...(typeof s.title === "string" && s.title ? { title: s.title } : {}),
    ...(typeof s.author === "string" && s.author ? { author: s.author } : {}),
  }),
  component: function CatalogueRoute() {
    const { title, author } = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <CataloguePage
        openTitle={title ?? ""}
        setOpenTitle={(id) => void navigate({ search: { ...(id ? { title: id } : {}), ...(author ? { author } : {}) } as never })}
        author={author ?? ""}
        setAuthor={(a) => void navigate({ search: { ...(title ? { title } : {}), ...(a ? { author: a } : {}) } as never })}
      />
    );
  },
});
