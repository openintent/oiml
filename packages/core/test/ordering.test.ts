import { describe, expect, it } from "vitest";
import {
  Model,
  applyDiff,
  compile,
  hasMoveAction,
  orderObjects,
  parseDiff,
  planMigration,
  positionOf,
  relationNamesOf,
  renderPostgres,
  resolveStepOp,
  ruleText,
  throughRelation,
  userActions,
  validateModel
} from "../src/index.js";

/** Albums with tracks in order, genres through a junction, and playlists whose entries are an ordered junction */
function model(change: (m: Record<string, any>) => void = () => {}): Model {
  const raw: Record<string, any> = {
    osl: "1.0",
    name: "music",
    entities: {
      User: {
        fields: {
          id: { type: "uuid", primary: true },
          email: { type: "string", required: true, unique: true },
          name: { type: "string", required: true }
        },
        rules: { read: "public", update: "owner:id", delete: "none" }
      },
      Album: {
        fields: {
          id: { type: "uuid", primary: true },
          owner_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
          title: { type: "string", required: true }
        },
        rules: { read: "public", create: "owner:owner_id", update: "owner:owner_id", delete: "owner:owner_id" }
      },
      Track: {
        fields: {
          id: { type: "uuid", primary: true },
          album_id: {
            type: "uuid",
            required: true,
            relation: { entity: "Album", name: "album", reverse: "tracks", on_delete: "cascade" }
          },
          title: { type: "string", required: true },
          track_number: { type: "integer", position: { within: "album_id" } }
        },
        rules: {
          read: "public",
          create: "owner:album_id.owner_id",
          update: "owner:album_id.owner_id",
          delete: "owner:album_id.owner_id"
        },
        relations: { genres: { through: "TrackGenre" } }
      },
      Genre: {
        fields: { id: { type: "uuid", primary: true }, name: { type: "string", required: true, unique: true } },
        rules: { read: "public", create: "authenticated", update: "none", delete: "none" }
      },
      TrackGenre: {
        fields: {
          id: { type: "uuid", primary: true },
          track_id: { type: "uuid", required: true, relation: { entity: "Track", on_delete: "cascade" } },
          genre_id: { type: "uuid", required: true, relation: { entity: "Genre", on_delete: "cascade" } }
        },
        unique: [["track_id", "genre_id"]],
        rules: { read: "public", create: "owner:track_id.album_id.owner_id", update: "none", delete: "authenticated" }
      },
      Playlist: {
        fields: {
          id: { type: "uuid", primary: true },
          owner_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
          name: { type: "string", required: true }
        },
        rules: { read: "public", create: "owner:owner_id", update: "owner:owner_id", delete: "owner:owner_id" },
        relations: { tracks: { through: "PlaylistTrack" } }
      },
      PlaylistTrack: {
        fields: {
          id: { type: "uuid", primary: true },
          playlist_id: {
            type: "uuid",
            required: true,
            relation: { entity: "Playlist", reverse: "entries", on_delete: "cascade" }
          },
          track_id: { type: "uuid", required: true, relation: { entity: "Track", on_delete: "cascade" } },
          position: { type: "integer", position: { within: "playlist_id" } }
        },
        rules: {
          read: "public",
          create: "owner:playlist_id.owner_id",
          update: "owner:playlist_id.owner_id",
          delete: "owner:playlist_id.owner_id"
        }
      }
    },
    resources: {
      albums: { entity: "Album", operations: ["list", "get", "create"], get: { include: ["tracks"] } },
      tracks: {
        entity: "Track",
        operations: ["list", "get", "create", "update", "delete"],
        list: { filters: ["album_id"], include: ["album", "genres"] },
        get: { include: ["genres"] }
      },
      playlists: { entity: "Playlist", operations: ["list", "get", "create"], get: { include: ["tracks"] } },
      playlist_tracks: { entity: "PlaylistTrack", operations: ["list", "create", "delete"] }
    },
    auth: { identity: "User", provider: "credentials" }
  };
  change(raw);
  return Model.parse(raw);
}

const codes = (m: Model, level: "error" | "warning" = "error") =>
  validateModel(m)
    .filter(d => d.level === level)
    .map(d => d.code);

describe("ordered collections in the model", () => {
  it("accepts a position within a required relation and names its field and parent", () => {
    const m = model();
    expect(codes(m)).toEqual([]);
    expect(positionOf(m.entities.Track)).toEqual({ field: "track_number", within: "album_id" });
    expect(positionOf(m.entities.Album)).toBeUndefined();
  });

  it("refuses a position that is not a plain integer", () => {
    expect(() => model(m => (m.entities.Track.fields.track_number.type = "string"))).toThrow(/position only applies/);
    expect(() => model(m => (m.entities.Track.fields.track_number.default = 1))).toThrow(/plain integer/);
    expect(() => model(m => (m.entities.Track.fields.track_number.unique = true))).toThrow(/plain integer/);
  });

  it("refuses a parent that is not a required relation to another entity (M140)", () => {
    expect(codes(model(m => (m.entities.Track.fields.track_number.position.within = "title")))).toContain("M140");
    expect(codes(model(m => (m.entities.Track.fields.track_number.position.within = "nowhere")))).toContain("M140");
    expect(codes(model(m => delete m.entities.Track.fields.album_id.required))).toContain("M140");
    const tree = model(m => {
      m.entities.Track.fields.parent_id = { type: "uuid", required: true, relation: { entity: "Track" } };
      m.entities.Track.fields.track_number.position.within = "parent_id";
    });
    expect(codes(tree)).toContain("M140");
  });

  it("refuses two positions (M141) and a composite key (M142)", () => {
    const two = model(m => {
      m.entities.Track.fields.rank = { type: "integer", position: { within: "album_id" } };
    });
    expect(codes(two)).toContain("M141");
    const composite = model(m => {
      delete m.entities.PlaylistTrack.fields.id;
      m.entities.PlaylistTrack.fields.playlist_id.primary = true;
      m.entities.PlaylistTrack.fields.track_id.primary = true;
      delete m.resources.playlist_tracks;
    });
    expect(codes(composite)).toContain("M142");
  });

  it("keeps move for the compiler (M143), the parent out of update (M144) and the position out of the fields (M064)", () => {
    const own = model(m => (m.resources.tracks.actions = { move: { rule: "authenticated" } }));
    expect(codes(own)).toContain("M143");
    const reparent = model(m => (m.resources.tracks.update = { fields: ["title", "album_id"] }));
    expect(codes(reparent)).toContain("M144");
    const written = model(m => (m.resources.tracks.create = { fields: ["album_id", "title", "track_number"] }));
    expect(codes(written)).toContain("M064");
  });

  it("resolves tracks.move as a step, and not where the update rule is none", () => {
    const m = model();
    expect(resolveStepOp(m, "tracks.move")).toEqual({ kind: "action", resource: "tracks", action: "move" });
    expect(resolveStepOp(m, "albums.move").kind).toBe("unknown");
    const frozen = model(x => (x.entities.Track.rules.update = "none"));
    expect(hasMoveAction(frozen, frozen.resources.tracks)).toBe(false);
    expect(resolveStepOp(frozen, "tracks.move").kind).toBe("unknown");
  });
});

describe("relations through a junction in the model", () => {
  it("finds the junction's two fields and the far entity", () => {
    const m = model();
    expect(throughRelation(m, "Track", "genres")).toEqual({
      junction: "TrackGenre",
      from: "track_id",
      to: "genre_id",
      target: "Genre"
    });
    expect(throughRelation(m, "Track", "nothing")).toBeNull();
    expect(relationNamesOf(m, "Track")).toEqual(["album", "genres"]);
  });

  it("asks for from and to when the junction does not say which (M014)", () => {
    const follows = (relations: Record<string, unknown>) =>
      model(m => {
        m.entities.Follow = {
          fields: {
            id: { type: "uuid", primary: true },
            follower_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
            followee_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } }
          }
        };
        m.entities.User.relations = relations;
      });
    expect(codes(follows({ following: { through: "Follow" } }))).toContain("M014");
    const named = follows({ following: { through: "Follow", from: "follower_id", to: "followee_id" } });
    expect(codes(named)).toEqual([]);
    expect(throughRelation(named, "User", "following")).toMatchObject({ from: "follower_id", to: "followee_id" });
    expect(codes(follows({ following: { through: "Follow", from: "follower_id", to: "follower_id" } }))).toContain(
      "M014"
    );
    expect(codes(model(m => (m.entities.Track.relations = { genres: { through: "Nowhere" } })))).toContain("M014");
    expect(codes(model(m => (m.entities.Genre.relations = { albums: { through: "PlaylistTrack" } })))).toContain(
      "M014"
    );
  });

  it("refuses a name a field or another relation has (M015) and an include that names nothing (M055)", () => {
    expect(codes(model(m => (m.entities.Track.relations = { title: { through: "TrackGenre" } })))).toContain("M015");
    expect(codes(model(m => (m.entities.Track.relations = { album: { through: "TrackGenre" } })))).toContain("M015");
    expect(codes(model(m => (m.resources.albums.get = { include: ["genres"] })))).toContain("M055");
  });

  it("shows a relation as a page column only when the list includes it (M083)", () => {
    const page = (include: string[]) =>
      model(m => {
        m.resources.tracks.list = { include };
        m.app = { pages: { tracks: { resource: "tracks", columns: ["title", "genres"], access: "public" } } };
      });
    expect(codes(page(["genres"]))).toEqual([]);
    expect(codes(page([]))).toContain("M083");
    expect(compile(page(["genres"])).app!.pages[0]).toMatchObject({ columns: ["title"], relations: ["genres"] });
  });
});

describe("the compiled order and relations", () => {
  const ir = compile(model());
  const entity = (name: string) => ir.entities.find(e => e.name === name)!;
  const resource = (name: string) => ir.resources.find(r => r.name === name)!;

  it("makes the position a column the database numbers", () => {
    expect(entity("Track").columns.find(c => c.name === "track_number")).toMatchObject({
      nullable: false,
      readOnly: true,
      position: true,
      default: { kind: "literal", value: 0 }
    });
    expect(entity("Track").order).toEqual({
      column: "track_number",
      within: "album_id",
      parentEntity: "Album",
      parentTable: "albums",
      parentKey: "id",
      unique: { name: "tracks_album_id_track_number_key", columns: ["album_id", "track_number"] },
      assign: "osl_position_tracks",
      close: "osl_close_tracks",
      move: "osl_move_tracks",
      remove: "osl_remove_tracks"
    });
    expect(entity("Album").order).toBeUndefined();
  });

  it("orders lists and reverse includes by it, keeps it and the parent out of the inputs", () => {
    const ops = resource("tracks").operations;
    expect(ops.find(o => o.kind === "list")).toMatchObject({
      order: [
        ["album_id", "asc"],
        ["track_number", "asc"]
      ]
    });
    expect((ops.find(o => o.kind === "create") as { fields: string[] }).fields).toEqual(["album_id", "title"]);
    expect((ops.find(o => o.kind === "update") as { fields: string[] }).fields).toEqual(["title"]);
    expect(entity("Album").relations.find(r => r.name === "tracks")).toMatchObject({
      direction: "reverse",
      orderBy: "track_number"
    });
    expect(entity("Playlist").relations.find(r => r.name === "entries")!.orderBy).toBe("position");
  });

  it("adds move under the update rule, as an action no handler of the user's answers", () => {
    const move = ir.actions.find(a => a.resource === "tracks" && a.name === "move")!;
    expect(move).toMatchObject({
      scope: "row",
      path: "/api/tracks/{id}/move",
      builtin: "move",
      returns: { kind: "entity" }
    });
    expect(move.input).toMatchObject([{ name: "to", nullable: false, validate: { min: 1 } }]);
    expect(ruleText(move.rule)).toBe("owner:album_id.owner_id");
    expect(ir.actions.filter(a => a.builtin).map(a => a.resource)).toEqual(["tracks", "playlist_tracks"]);
    expect(userActions(ir)).toEqual([]);
    const frozen = compile(model(m => (m.entities.Track.rules.update = "none")));
    expect(frozen.actions.some(a => a.resource === "tracks")).toBe(false);
  });

  it("compiles a relation through a junction and splits it from the other includes", () => {
    expect(entity("Track").through).toEqual([
      {
        name: "genres",
        junction: "TrackGenre",
        junctionTable: "track_genres",
        from: "track_id",
        sourceColumn: "id",
        to: "genre_id",
        target: "Genre",
        targetColumn: "id"
      }
    ]);
    // An ordered junction gives the far rows its order
    expect(entity("Playlist").through![0]).toMatchObject({ name: "tracks", target: "Track", orderBy: "position" });
    expect(resource("tracks").operations.find(o => o.kind === "list")).toMatchObject({
      include: ["album"],
      through: ["genres"]
    });
    expect(resource("tracks").operations.find(o => o.kind === "get")).toMatchObject({
      include: [],
      through: ["genres"]
    });
    // Nothing is added to an operation without one, so models without the construct compile as they did
    expect(resource("albums").operations.find(o => o.kind === "get")).not.toHaveProperty("through");
    expect(entity("Album")).not.toHaveProperty("through");
  });
});

describe("the database side of an order", () => {
  it("makes the constraint, five functions and two triggers per ordered entity", () => {
    const objects = orderObjects(compile(model()));
    expect(
      objects.filter(o => o.table === "tracks" || o.name.endsWith("_tracks")).map(o => `${o.kind} ${o.name}`)
    ).toEqual(
      expect.arrayContaining([
        "constraint tracks_album_id_track_number_key",
        "function osl_hold_tracks",
        "function osl_position_tracks",
        "function osl_close_tracks",
        "function osl_move_tracks",
        "function osl_remove_tracks",
        "trigger osl_order_assign",
        "trigger osl_order_close"
      ])
    );
    const constraint = objects.find(o => o.kind === "constraint")!;
    expect(constraint.create[0]).toBe(
      'ALTER TABLE "tracks" ADD CONSTRAINT "tracks_album_id_track_number_key" UNIQUE ("album_id", "track_number") DEFERRABLE INITIALLY IMMEDIATE;'
    );
    const fn = (name: string) => objects.find(o => o.kind === "function" && o.name === name)!;
    // Append, move and remove wait for the parent's lock and for nothing after it; the trigger that follows a
    // delete waits for nothing at all
    expect(fn("osl_position_tracks").body!.source).toContain(
      'FROM "albums" WHERE "id" = NEW."album_id" FOR NO KEY UPDATE;'
    );
    // An append takes no row of the parent: the checks of its own relations still follow
    expect(fn("osl_position_tracks").body!.source).not.toContain('FROM "tracks" WHERE "album_id" = NEW."album_id" FOR');
    expect(fn("osl_hold_tracks").body!.source).toContain('FROM "albums" WHERE "id" = osl_parent FOR NO KEY UPDATE;');
    expect(fn("osl_hold_tracks").body!.source).toContain(
      'FROM "tracks" WHERE "album_id" = osl_parent FOR UPDATE NOWAIT;'
    );
    for (const name of ["osl_move_tracks", "osl_remove_tracks"])
      expect(fn(name).body!.source).toContain('PERFORM "osl_hold_tracks"(osl_parent);');
    expect(fn("osl_close_tracks").body!.source).toContain("FOR NO KEY UPDATE NOWAIT;");
    expect(fn("osl_close_tracks").body!.source).not.toMatch(/FOR (NO KEY )?UPDATE;/);
    expect(fn("osl_move_tracks").body!.definer).toBe(false);
    expect(fn("osl_move_tracks").create.join("\n")).not.toContain("SECURITY DEFINER");
  });

  it("creates them after the table and numbers the rows of a table that gains a position", () => {
    const fresh = renderPostgres(planMigration(null, compile(model())));
    expect(fresh.indexOf('CREATE TABLE "tracks"')).toBeLessThan(fresh.indexOf('CREATE FUNCTION "osl_move_tracks"'));
    expect(fresh).toContain('"track_number" integer NOT NULL DEFAULT 0');
    expect(fresh).not.toContain("row_number() OVER (PARTITION BY");

    const before = compile(model(m => delete m.entities.Track.fields.track_number));
    const plan = planMigration(before, compile(model()));
    const kinds = plan.steps.map(s => (s.kind === "sql" ? s.about : s.kind));
    expect(kinds.slice(0, 3)).toEqual([
      "add_column",
      "backfill_position",
      "constraint tracks_album_id_track_number_key"
    ]);
    expect(plan.rewrites.map(s => s.kind)).toEqual(["backfill_position"]);
    expect(renderPostgres(plan)).toContain(
      'UPDATE "tracks" AS r SET "track_number" = o.place FROM (SELECT "id" AS id, row_number() OVER (PARTITION BY "album_id" ORDER BY "id") AS place FROM "tracks") AS o WHERE r."id" = o.id;'
    );

    const gone = planMigration(compile(model()), before);
    const dropped = gone.steps.map(s => (s.kind === "sql" ? s.about : s.kind));
    expect(dropped.indexOf("drop constraint tracks_album_id_track_number_key")).toBeGreaterThan(
      dropped.indexOf("drop trigger osl_order_assign")
    );
    expect(dropped.indexOf("drop_column")).toBeGreaterThan(dropped.indexOf("drop function osl_move_tracks"));
  });

  it("follows a renamed parent field without numbering the rows again", () => {
    const renamed = applyDiff(
      model(),
      parseDiff({ osl: "1.0", ops: [{ op: "rename_field", entity: "Track", from: "album_id", to: "record_id" }] })
    );
    expect(renamed.model.entities.Track.fields.track_number.position).toEqual({ within: "record_id" });
    const plan = planMigration(compile(model()), compile(renamed.model), renamed.renames);
    expect(plan.steps.some(s => s.kind === "backfill_position")).toBe(false);
    const sql = renderPostgres(plan);
    expect(sql).toContain('RENAME COLUMN "album_id" TO "record_id"');
    expect(sql).toContain('UNIQUE ("record_id", "track_number") DEFERRABLE');
  });
});

describe("the ops that keep relations and positions", () => {
  const apply = (m: Model, ops: unknown[]) => applyDiff(m, parseDiff({ osl: "1.0", ops })).model;

  it("sets and removes an entity's relations", () => {
    const added = apply(model(), [
      { op: "set_relations", entity: "Genre", relations: { tracks: { through: "TrackGenre" } } }
    ]);
    expect(added.entities.Genre.relations).toEqual({ tracks: { through: "TrackGenre" } });
    expect(compile(added).entities.find(e => e.name === "Genre")!.through![0]).toMatchObject({
      from: "genre_id",
      to: "track_id",
      target: "Track"
    });
    expect(
      apply(added, [{ op: "set_relations", entity: "Genre", relations: {} }]).entities.Genre.relations
    ).toBeUndefined();
  });

  it("follows renames and refuses to remove what a relation or a position stands on", () => {
    const named = model(m => (m.entities.Track.relations = { genres: { through: "TrackGenre", to: "genre_id" } }));
    const renamed = apply(named, [
      { op: "rename_field", entity: "TrackGenre", from: "genre_id", to: "style_id" },
      { op: "rename_entity", from: "TrackGenre", to: "TrackStyle" }
    ]);
    expect(renamed.entities.Track.relations).toEqual({ genres: { through: "TrackStyle", to: "style_id" } });
    expect(() => apply(named, [{ op: "remove_field", entity: "TrackGenre", name: "genre_id" }])).toThrow(
      /Track.relations.genres still names/
    );
    const plain = model(m => {
      m.entities.Track.rules = { read: "public", create: "authenticated", update: "authenticated", delete: "none" };
      m.entities.TrackGenre.rules = { read: "public", create: "authenticated", update: "none", delete: "none" };
    });
    expect(() => apply(plain, [{ op: "remove_field", entity: "Track", name: "album_id" }])).toThrow(
      /position within album_id/
    );
    const bare = model(m => {
      delete m.resources.playlist_tracks;
    });
    expect(() => apply(bare, [{ op: "remove_entity", name: "PlaylistTrack" }])).toThrow(/still goes through/);
  });
});

describe("an order under isolation: database", () => {
  /** Teams with projects and milestones in order: the milestone's tenant is derived through its project */
  const isolated = Model.parse({
    osl: "1.0",
    name: "work",
    entities: {
      User: {
        fields: { id: { type: "uuid", primary: true }, email: { type: "string", required: true, unique: true } },
        rules: { read: "authenticated", update: "owner:id", delete: "none" }
      },
      Team: {
        fields: { id: { type: "uuid", primary: true }, name: { type: "string", required: true } },
        rules: { read: "member:id", create: "authenticated", update: "member:id:admin", delete: "member:id:owner" }
      },
      TeamMember: {
        fields: {
          id: { type: "uuid", primary: true },
          team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } },
          user_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
          role: { type: "enum", enum_values: ["owner", "admin", "member"], required: true, default: "member" }
        },
        unique: [["team_id", "user_id"]],
        rules: {
          read: "member:team_id",
          create: "member:team_id:admin",
          update: "none",
          delete: "member:team_id:owner"
        }
      },
      Project: {
        fields: {
          id: { type: "uuid", primary: true },
          team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } },
          name: { type: "string", required: true }
        },
        rules: { read: "member:team_id", create: "member:team_id", update: "member:team_id", delete: "member:team_id" }
      },
      Milestone: {
        fields: {
          id: { type: "uuid", primary: true },
          project_id: { type: "uuid", required: true, relation: { entity: "Project", on_delete: "cascade" } },
          title: { type: "string", required: true },
          position: { type: "integer", position: { within: "project_id" } }
        },
        rules: {
          read: "member:project_id.team_id",
          create: "member:project_id.team_id",
          update: "member:project_id.team_id",
          delete: "member:project_id.team_id"
        }
      }
    },
    resources: { milestones: { entity: "Milestone", operations: ["list", "get", "create", "delete"] } },
    auth: {
      identity: "User",
      provider: "credentials",
      tenancy: {
        entity: "Team",
        membership: "TeamMember",
        role_field: "role",
        creator_role: "owner",
        isolation: "database"
      }
    }
  });

  it("runs the functions with the owner's rights and tests the row against the tenant policy by hand", () => {
    expect(validateModel(isolated).filter(d => d.level === "error")).toEqual([]);
    const objects = orderObjects(compile(isolated));
    const fn = (name: string) => objects.find(o => o.kind === "function" && o.name === name)!;
    const guard = `AND "team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[])`;
    for (const name of ["osl_move_milestones", "osl_remove_milestones"]) {
      expect(fn(name).body!.definer).toBe(true);
      expect(fn(name).body!.source).toContain(`WHERE "id" = osl_row ${guard};`);
      expect(fn(name).create.join("\n")).toContain(`GRANT EXECUTE ON FUNCTION "${name}"`);
    }
    // The trigger functions count a place among every sibling, whoever's it is: definer, and nobody calls them
    for (const name of ["osl_hold_milestones", "osl_position_milestones", "osl_close_milestones"]) {
      expect(fn(name).body!.definer).toBe(true);
      expect(fn(name).create.join("\n")).toContain("REVOKE ALL ON FUNCTION");
      expect(fn(name).create.join("\n")).not.toContain("GRANT EXECUTE");
    }
    // move is the update rule, narrowed to the row's tenant like every rule of a tenant table
    const move = compile(isolated).actions.find(a => a.name === "move")!;
    expect(ruleText(move.rule)).toBe("member:project_id.team_id");
  });
});
