import type { ShopifyProductPayload } from "./payload";

/**
 * Shopify Admin API (GraphQL) クライアント (6b, 推奨経路)。
 * カスタムアプリの Admin APIアクセストークン (write_products) が必要。
 * 画像は Storage の公開URLを media.originalSource に渡して Shopify 側に取得させる。
 */

interface ShopifyConfig {
  domain: string;
  token: string;
  apiVersion: string;
}

function getConfig(): ShopifyConfig {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2025-01";
  if (!domain || !token) {
    throw new Error(
      "SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN が未設定です (.env.local を確認)"
    );
  }
  return { domain, token, apiVersion };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const { domain, token, apiVersion } = getConfig();
  const res = await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify API HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQLエラー: ${json.errors.map((e) => e.message).join(" / ")}`);
  }
  if (!json.data) throw new Error("Shopify APIレスポンスにdataがありません");
  return json.data;
}

/** 認証疎通テスト: ショップ名とAPIバージョンを返す */
export async function testConnection(): Promise<{ shopName: string; domain: string }> {
  const data = await shopifyGraphQL<{ shop: { name: string; myshopifyDomain: string } }>(
    `query { shop { name myshopifyDomain } }`,
    {}
  );
  return { shopName: data.shop.name, domain: data.shop.myshopifyDomain };
}

const PRODUCT_SET_MUTATION = `
mutation productSet($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) {
    product {
      id
      handle
      variants(first: 1) { nodes { id sku } }
    }
    userErrors { field message }
  }
}`;

export interface CreateResult {
  productGid: string;
  handle: string;
}

/** ShopifyProductPayload → productSet で draft 商品を作成 (単一バリアント) */
export async function createDraftProduct(
  payload: ShopifyProductPayload
): Promise<CreateResult> {
  const input: Record<string, unknown> = {
    title: payload.title,
    handle: payload.handle,
    descriptionHtml: payload.bodyHtml,
    vendor: payload.vendor || undefined,
    productType: payload.productType || undefined,
    tags: payload.tags,
    status: payload.status.toUpperCase(), // DRAFT / ACTIVE
    productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
    variants: [
      {
        optionValues: [{ optionName: "Title", name: "Default Title" }],
        sku: payload.variant.sku,
        price: payload.variant.price !== null ? String(payload.variant.price) : undefined,
        compareAtPrice:
          payload.variant.compareAtPrice !== null
            ? String(payload.variant.compareAtPrice)
            : undefined,
        inventoryPolicy: payload.variant.inventoryPolicy.toUpperCase(), // CONTINUE / DENY
        taxable: true,
        inventoryItem: {
          sku: payload.variant.sku,
          tracked: true,
          requiresShipping: true,
          cost: payload.variant.costPerItem ?? undefined,
          measurement: {
            weight: { unit: "GRAMS", value: payload.variant.grams },
          },
        },
      },
    ],
  };

  if (payload.images.length > 0) {
    input.files = payload.images.map((img) => ({
      originalSource: img.src,
      alt: img.altText,
      contentType: "IMAGE",
    }));
  }

  const data = await shopifyGraphQL<{
    productSet: {
      product: { id: string; handle: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(PRODUCT_SET_MUTATION, { input });

  const { product, userErrors } = data.productSet;
  if (userErrors.length > 0) {
    throw new Error(
      `productSet userErrors: ${userErrors
        .map((e) => `${e.field?.join(".") ?? ""}: ${e.message}`)
        .join(" / ")}`
    );
  }
  if (!product) throw new Error("productSetがproductを返しませんでした");
  return { productGid: product.id, handle: product.handle };
}
