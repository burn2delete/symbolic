import { Schema, SchemaAST } from "effect"
import z from "zod"

export function zod<S extends Schema.Top>(schema: S): z.ZodType<Schema.Schema.Type<S>> {
  return walk(schema.ast) as z.ZodType<Schema.Schema.Type<S>>
}

function walk(ast: SchemaAST.AST): z.ZodTypeAny {
  const out = body(ast)
  const desc = SchemaAST.resolveDescription(ast)
  const ref = SchemaAST.resolveIdentifier(ast)
  const next = desc ? out.describe(desc) : out
  return ref ? next.meta({ ref }) : next
}

function body(ast: SchemaAST.AST): z.ZodTypeAny {
  if (SchemaAST.isOptional(ast)) return opt(ast)

  switch (ast._tag) {
    case "String":
      return z.string()
    case "Number":
      return z.number()
    case "Boolean":
      return z.boolean()
    case "Null":
      return z.null()
    case "Undefined":
      return z.undefined()
    case "Any":
    case "Unknown":
      return z.unknown()
    case "Never":
      return z.never()
    case "Literal":
      return z.literal(ast.literal)
    case "Union":
      return union(ast)
    case "Objects":
      return obj(ast)
    case "Arrays":
      return arr(ast)
    case "Declaration":
      return decl(ast)
    case "Suspend":
      return walk(ast.thunk())
    default:
      return fail(ast)
  }
}

function opt(ast: SchemaAST.AST): z.ZodTypeAny {
  if (ast._tag !== "Union") return fail(ast)
  const list = ast.types.filter((item) => item._tag !== "Undefined")
  if (list.length === 1) return walk(list[0]).optional()
  if (list.length > 1) return z.union(list.map(walk) as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]).optional()
  return z.undefined().optional()
}

function union(ast: SchemaAST.Union): z.ZodTypeAny {
  const list = ast.types.map(walk)
  if (list.length === 1) return list[0]
  if (list.length < 2) return fail(ast)
  return z.union(list as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
}

function obj(ast: SchemaAST.Objects): z.ZodTypeAny {
  if (ast.propertySignatures.length === 0 && ast.indexSignatures.length === 1) {
    const sig = ast.indexSignatures[0]
    if (sig.parameter._tag !== "String") return fail(ast)
    return z.record(z.string(), walk(sig.type))
  }

  if (ast.indexSignatures.length > 0) return fail(ast)

  return z.object(Object.fromEntries(ast.propertySignatures.map((sig) => [String(sig.name), walk(sig.type)])))
}

function arr(ast: SchemaAST.Arrays): z.ZodTypeAny {
  if (ast.elements.length > 0) return fail(ast)
  if (ast.rest.length !== 1) return fail(ast)
  return z.array(walk(ast.rest[0]))
}

function decl(ast: SchemaAST.Declaration): z.ZodTypeAny {
  if (ast.typeParameters.length !== 1) return fail(ast)
  return walk(ast.typeParameters[0])
}

function fail(ast: SchemaAST.AST): never {
  const ref = SchemaAST.resolveIdentifier(ast)
  throw new Error(`unsupported effect schema: ${ref ?? ast._tag}`)
}
