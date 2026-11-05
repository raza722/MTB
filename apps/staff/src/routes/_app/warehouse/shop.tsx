import { createFileRoute } from "@tanstack/react-router";
import { ShopPage } from "../../../features/warehouse";

/** /warehouse/shop — sell books, uniform and stationery to students with an A5 receipt. */
export const Route = createFileRoute("/_app/warehouse/shop")({
  component: ShopPage,
});
