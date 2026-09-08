process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { articleFromLine, articleToDocLine, deleteArticle, listArticles, upsertArticle } from "./articles";
import { db } from "../store";

describe("artikelregister", () => {
  it("sparar, listar och tar bort artiklar i meta", () => {
    db().meta.articles = [];
    const saved = upsertArticle({
      description: "Montering kök",
      kind: "arbete",
      unit: "tim",
      unitPrice: 650,
      vatRate: 25,
    });
    assert.equal(listArticles().length, 1);
    assert.equal(listArticles()[0]?.description, "Montering kök");
    deleteArticle(saved.id);
    assert.equal(listArticles().length, 0);
  });

  it("artikel blir en ifylld dokumentrad", () => {
    const line = articleToDocLine({
      id: "a1",
      description: "Slang 15 mm",
      kind: "material",
      unit: "m",
      unitPrice: 40,
      vatRate: 25,
      discountPercent: 10,
    });
    assert.equal(line.description, "Slang 15 mm");
    assert.equal(line.unit, "m");
    assert.equal(line.unitPrice, 40);
    assert.equal(line.discountPercent, 10);
    assert.equal(line.kind, "material");
  });

  it("rad kan sparas tillbaka som artikel", () => {
    db().meta.articles = [];
    const article = articleFromLine({
      description: "Restid",
      kind: "resor",
      unit: "tim",
      unitPrice: 450,
      vatRate: 25,
    });
    assert.equal(article.description, "Restid");
    assert.equal(listArticles()[0]?.id, article.id);
  });
});
