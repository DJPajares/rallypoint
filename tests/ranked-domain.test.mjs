import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calibratingCategories,
  calibratingLabel,
  rankLabel,
  rankSpoken,
  rankedCategories,
} from "../packages/domain/src/ranked.ts";

const veteran = {
  activity: "pickleball",
  format: "doubles",
  medal: "Veteran",
  stars: 3,
};
const master = {
  activity: "pickleball",
  format: "singles",
  medal: "Master",
  stars: null,
};

test("rankLabel names the medal, its stars and the format", () => {
  assert.equal(rankLabel(veteran), "Veteran ★★★ · Doubles");
  assert.equal(rankLabel(master), "Master · Singles");
  assert.equal(
    rankLabel({ ...veteran, format: "mixed-doubles", stars: 1 }),
    "Veteran ★ · Mixed doubles",
  );
});

test("rankSpoken says the stars in words", () => {
  assert.equal(rankSpoken(veteran), "Doubles: Veteran, 3 of 5 stars");
  assert.equal(
    rankSpoken({ ...veteran, stars: 1 }),
    "Doubles: Veteran, 1 of 5 stars",
  );
  assert.equal(rankSpoken(master), "Singles: Master");
});

test("rankedCategories drops unknown medals and shapes", () => {
  assert.deepEqual(
    rankedCategories([
      veteran,
      master,
      { ...veteran, medal: "Gold" },
      { ...veteran, stars: 6 },
      { ...veteran, stars: null },
      { ...master, stars: 2 },
      { activity: "pickleball", format: "doubles", calibrating: 3 },
      null,
      "Veteran",
    ]),
    [veteran, master],
  );
  assert.deepEqual(rankedCategories(undefined), []);
});

test("calibration reads as matches played of 5", () => {
  const calibrating = {
    activity: "pickleball",
    format: "doubles",
    calibrating: 3,
  };
  assert.deepEqual(
    calibratingCategories([
      calibrating,
      veteran,
      { ...calibrating, calibrating: 5 },
    ]),
    [calibrating],
  );
  assert.equal(calibratingLabel(calibrating), "Calibrating · 3 of 5");
});
