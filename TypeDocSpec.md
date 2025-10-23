TDL — Typedoc Definition Language

1. Document shape

A TDL document is a single YAML mapping containing:

- Optional value sections (plain YAML, not TDL expressions):
  - _primitives: sequence of reserved atomic type names (arity 0).
    Default: ["string","number","boolean","image","audio","video","typedoc","never"].
    Notes:
    - never denotes an unsatisfiable type (no value can inhabit it).
  - _externals: mapping Name: Arity for host type constructors.
    - arity > 0 → generic constructor, used as Name<...> (structural).
    - arity = 0 → nominal atomic type (no &, no <...>), equality by name only.
    - Externals may be used anywhere a type appears (including property values).
  - _imports: mapping alias → source, used to reference TypeDefinitions (not symbols) from other typedocs.
    Sources:
    - typedoc string (YAML-encoded TDL document),
    - DocPath (see §7) to a typedoc value,
    - or a host-resolved locator (e.g., file path or URL string) if your host supports it.
    Resolution:
    - alias::TypeName refers to a TypeDefinition in the imported doc.
    - Only statically available imports (typedoc strings and host-resolved locators) may be referenced as alias::TypeName at authoring time; DocPath imports are allowed for late-bound introspection via intrinsics but MUST NOT be used in alias::TypeName references (they are not statically resolvable).
  - _comments: mapping Target → text (YAML block scalars).
    Target is TypeName or TypeName.path.to.prop or symbol_name.

- Type definitions (labels start Capitalized)
  - Alias:
    TypeName: <TypeExpr or InlineObject>
  - Object type:
    TypeName:
      prop_name[]? or prop_name?[]: <TypeExpr or InlineObject>
      [k: string|EnumLikeExpr][]? or [k: string|EnumLikeExpr]?[]: <TypeExpr or InlineObject>
  - Generics:
    TypeName<T, U>: <TypeExpr or InlineObject> (or object form).
  - Extends sugar (changed):
    Derived(Base & Other):
      <object body>
    Semantics: Base & Other & <body> (rightmost wins).

- Symbol declarations (labels start lowercase)
  - Symbols are the public interface of the document: named, typed “exports”.
  - All top-level symbols are considered active by default for an LLM run.
  - Form:
    symbol_name[]? or symbol_name?[]: <TypeExpr or InlineObject>

RHS node kinds:
- A TypeExpr may be a scalar (TDL expression) or a block-mapping InlineObject (inline object shape).
- Flow-style YAML collections are forbidden anywhere in TDL declarations: no {...} mappings and no [...] sequences as YAML nodes on any RHS.

Array notation placement:
- [] is allowed only on property and symbol labels to mark “array of …”.
- [] is forbidden on the RHS of any type expression (SomeType[] is invalid).
- [] is forbidden on the label of a top-level type definition (TypeName[]: … is invalid).
- [] is allowed on top-level symbol labels (symbols may be arrays).
- Suffix order flexibility: both name[]? and name?[] are accepted; same for index signatures.

Curly-brace ban (scalars):
- The characters { and } MUST NOT appear in any unquoted scalar TypeExpr.
- Braces are allowed inside quoted string literals.

2. Comments

- Inline YAML comments (# …) are allowed:
  - on the same line as a type definition label, and
  - on the same line as a property or symbol label.
- Multi-line documentation goes under _comments with keys TypeName, TypeName.path.to.prop, or symbol_name.

3. Names and tokens

- TypeName := ^[A-Z][A-Za-z0-9]*$ and MUST NOT be all-caps; it must contain at least one lowercase letter (e.g., Person, HTTPServer ok; USER not allowed).
- prop_name / symbol_name := ^[a-z][A-Za-z0-9_]*$
- TypeParam := ^[A-Z][A-Za-z0-9_]*$
- ALL_CAPS_TOKEN := ^[A-Z][A-Z0-9_]*$
- String literals := '...' | "..."
- Number literals := integer or decimal number tokens (no sign inside the literal; unary minus can be expressed via unions if needed).
- Boolean literals := true | false
- Identifier := ^[A-Za-z_][A-Za-z0-9_]*$
- Reserved keywords: if, then, else, infer, This
- Reserved intrinsic identifiers: Ref, Keys, TypeNames, SymbolNames, SymbolType
- Lexical constraint: { and } are invalid inside any unquoted scalar TypeExpr.

4. Grammar

Notes:
- InlineObject is a block mapping in YAML, not a scalar.
- Intrinsics use function-call syntax only.
- There is no [] postfix type operator.
- Function types are allowed anywhere a ScalarTypeExpr is allowed.

TypeExprNode    := ScalarTypeExpr | InlineObject

ScalarTypeExpr  ::= Conditional

Conditional     ::= OrExpr
                  | "if" OrExpr "is" Pattern "then" ScalarTypeExpr "else" ScalarTypeExpr

OrExpr          ::= AndExpr { "|" AndExpr }
AndExpr         ::= Postfix { "&" Postfix }
Postfix         ::= Primary { TypeArgs }
TypeArgs        ::= "<" [ ScalarTypeExpr { "," ScalarTypeExpr } ] ">"

Primary         ::= "(" ScalarTypeExpr ")"
                  | FuncType
                  | StringLit
                  | NumberLit
                  | BooleanLit
                  | QualifiedTypeRef
                  | Identifier
                  | "This"
                  | IntrinsicCall

QualifiedTypeRef ::= Identifier "::" TypeName [ TypeArgs ]   # imported type reference

FuncType        ::= "(" [ Param { "," Param } ] ")" "=>" ReturnType
Param           ::= Identifier [ "?" ] ":" ScalarTypeExpr
ReturnType      ::= ScalarTypeExpr | "(" ")"

Pattern         ::= PatPrimary { PatTypeArgs }
PatPrimary      ::= Identifier | "(" "infer" Identifier ")"
PatTypeArgs     ::= "<" [ Pattern { "," Pattern } ] ">"

IntrinsicCall   ::= IntrinsicName "(" [ ArgList ] ")"
IntrinsicName   ::= "Keys" | "TypeNames" | "SymbolNames" | "SymbolType"
ArgList         ::= ScalarTypeExpr { "," ScalarTypeExpr }

InlineObject    ::= ObjectBody
ObjectBody      ::= { PropLine }
PropLine        ::= PropKey ":" TypeExprNode

PropKey         ::= prop_name [ "[]" ] [ "?" ]
                  | prop_name [ "?" ] [ "[]" ]
                  | "[" Identifier ":" KeyDomain "]" [ "[]" ] [ "?" ]
                  | "[" Identifier ":" KeyDomain "]" [ "?" ] [ "[]" ]

KeyDomain       ::= "string" | EnumLikeExpr

EnumLikeExpr    ::= a ScalarTypeExpr that denotes an enum (union of string, number, boolean literals and/or ALL_CAPS_TOKEN), possibly late-bound via intrinsics.

Top-level entries
- Type alias: TypeName ":" TypeExprNode
- Object type: TypeName ":" InlineObject
- Generic: TypeName "<" [ TypeParam { "," TypeParam } ] ">" ":" (TypeExprNode | InlineObject)
- Extends sugar (changed): "TypeName" "(" ScalarTypeExpr ")" ":" InlineObject
  Semantics: TypeName aliases/intersects (ScalarTypeExpr & InlineObjectBody).
- Symbol: prop_name [ "[]" ] [ "?" ] ":" TypeExprNode
          or prop_name [ "?" ] [ "[]" ] ":" TypeExprNode

DocPath (for typedoc intrinsics only)
- DocPath       ::= DocPathBase "." prop_name { "." prop_name }
- DocPathBase   ::= "This" | Identifier [ TypeArgs ]

RefPath (for Ref<T,K> path-based selection)
- RefPath       ::= RefPathBase "." prop_name { "." prop_name }
- RefPathBase   ::= "This" | Identifier [ TypeArgs ]  # base is not Ref<...>

5. Core semantics

5.1 Primitive types
- typedoc is a primitive string type whose values are complete TDL documents (YAML).
- never is uninhabited: no value validates; X & never = never; X | never = X.

5.2 Inline objects
- InlineObject denotes an object type defined in-place. Its body syntax and semantics match a named object type’s body.

5.3 Object openness (open-by-default)
- Object types are open by default: properties not mentioned explicitly and not covered by an index signature are permitted and unconstrained.
- AdditionalProperties-equivalent (closure): to forbid extra properties, add an optional string-key index signature to never:
  [k: string]? never
  Meaning: unknown keys are optional, but if present must satisfy never (impossible) ⇒ extra keys forbidden.
- Index signatures, when present, constrain their domain; open-object default only applies to keys outside explicit properties and outside any index-signature domain.

5.4 Arrays
- [] on a label marks the corresponding property or symbol as an array of the RHS type.
- [] is not a type operator and MUST NOT appear in scalar TypeExpr.
- Arrays cannot be aliased as top-level types; define element type separately and apply [] where used.

5.5 Index signatures (maps)
- Forms: [k: string][]?: V or [k: EnumLikeExpr][]?: V or the variants with ?[].
- Non-optional label with EnumLikeExpr → all enum members are present; optional → each enum key optional.
- For string-domain index signatures, keys are arbitrary strings; presence is not enforced (maps are open with respect to that domain).
- Explicit properties lie outside the index signature domain.

5.6 Unions vs enums
- A | B | C is an enum if every member is a string/number/boolean literal or ALL_CAPS_TOKEN; otherwise it is a union.
- EnumLikeExpr may be any ScalarTypeExpr that denotes an enum (including late-bound via intrinsics).

5.7 Intersections (&)
- Operands must be object-like (see 5.15). Merge left→right; on collisions:
  - explicit vs explicit: rightmost wins
  - explicit vs index: explicit wins
  - index vs index: identical domains → rightmost wins; otherwise both retained.
- Late-bound terms: if any operand is late-bound, the intersection is late-bound; object-likeness is checked at instantiation.

5.8 Functions
- Function types (a: T, b?: U) => R are allowed anywhere a ScalarTypeExpr is allowed.
- Optional parameters must be trailing.
- Return type "()" represents unit.

5.9 Externals
- _externals declares host constructors. Arity-0 externals are nominal, atomic (no &, no <...>).
- Arity>0 externals participate structurally; they may appear as value types, in unions/intersections, and in generics.

5.10 Conditionals with infer (advanced/optional)
- if A is Pattern then X else Y.
- infer allowed only in type-argument positions. infer variables are usable only in the THEN branch.
- Matching is nominal for arity-0 externals, structural otherwise. Distributes over unions on the left.
- Late-bound A keeps the whole conditional late-bound until instantiation.
- This feature is optional for implementations focused on LLM I/O; it can be omitted without impacting the rest of TDL.

5.11 Generics
- A generic is a type factory; concrete types have no free type parameters after substitution.
- Only concrete types may be referenced. Unapplied generics are invalid.
- Type variables cannot be applied as constructors (T<X> invalid if T is a type variable).

5.12 Keys intrinsic
- Keys(T) → enum of explicit property names of object-like T. Index signatures are not enumerated.
- Unions: Keys(T1 | T2 | …) = union of Keys(Ti).
- Late-bound: Keys(late-bound) is late-bound; it is resolved at instantiation or yields an error if T does not resolve to object-like.

5.13 Object unions and discriminators
- Canonical encoding for union-of-object values is the by-type-name wrapper:
  A | B | C is encoded as a single-key mapping with the chosen TypeName as key:
  A: { ... } or B: { ... }
  This eliminates ambiguity and is LLM-friendly.
- Tools MUST accept the wrapper form. Tools MAY also support inline structural matching when unambiguous:
  - If exactly one branch validates, accept it.
  - If multiple branches validate, error: Ambiguous union; use the by-type-name wrapper.
  - Hosts MAY support a conventional discriminator property (e.g., type or $type equal to TypeName) as an alternative; this is not normative.

5.14 Ref (unified)
- Ref<T, K='name'> where T is either:
  - a concrete object-like type (global registry reference), or
  - a RefPath (path-based selection).
- RefPath base must be This or a TypeName; traversal unwraps across Ref intermediates.
- The last segment must denote a multi-valued collection: either
  - a property labeled with [] (array), or
  - any index signature (map), regardless of [].
- Identifier K: if provided, preferred id property; else prefer explicit "name": string, then "id": string; else opaque.
- JSON Schema lowering (optional guidance): lower to { type: "string" } and carry metadata in $comment or a host-specific extension (e.g., x-typedoc-ref) describing { kind: "global"|"path", targetType|path, elementType?, idProp?, keyIsIdentifier? }.
- YAML anchors (&/*) are outside TDL semantics and are purely syntactic within a YAML file; they are not substitutes for typed Refs.

5.15 Reference-pair sugar
- Authoring sugar anywhere a TypeExprNode is expected:
  - Ref<Base>.p1.p2...pn where Base is a concrete object-like type and pn is a collection on Base.
  - Desugars to: { owner: Ref<Base>, member: Ref<This.owner.p1.p2...pn> }.
- Tools must desugar before type-checking. Extensions may alias owner/member via named types.

5.16 This scoping
- This is valid only within a named type’s body (including any inline objects nested within that body), with concrete generic substitution.
- This refers to the nearest enclosing named type, not to anonymous inline shapes that do not have their own name.
- This is especially useful for DocPaths (e.g., SymbolNames(This.implementation_typedoc)) and for Ref paths relative to the current type (e.g., Ref<This.collection>).

5.17 Symbols (public interface)
- Symbols are lowercase top-level entries: symbol_name[]? : <TypeExpr or InlineObject>.
- A document may export zero or more symbols; there is no “default symbol.”
- Hosts may choose which symbols to exercise; by convention, “all symbols are active” is a valid LLM run mode.

6. Intrinsics over typedoc values

- Intrinsics are reserved identifiers and use function-call syntax only.
- Only the following operate on typedoc values:
  - TypeNames(doc: typedoc | DocPath) → enum of top-level TypeName identifiers defined in doc.
  - SymbolNames(doc: typedoc | DocPath) → enum of top-level symbol names defined in doc.
  - SymbolType(doc: typedoc | DocPath, name: string literal | enum member) → the declared type of the symbol named name in doc.
- Argument constraints and errors:
  - doc must denote a typedoc value (a string literal of type typedoc or a DocPath).
  - name must be a statically known string literal or a member of an EnumLike used where a string is required; otherwise error: SymbolType requires a static symbol name.
  - If name is not found in doc, error: Unknown symbol "name" in typedoc.
- Authoring vs instantiation:
  - Intrinsics whose doc argument is a literal typedoc string MUST be evaluated at authoring time (parse and type-check the referenced doc).
  - Intrinsics whose doc argument is a DocPath yield late-bound types; errors due to missing/ill-typed DocPath targets are reported at instantiation.

7. DocPath

- Valid only as the doc argument to typedoc intrinsics and as the base of Ref paths.
- A path A.b.c means: at instantiation time, read b.c from the nearest enclosing object whose declared type is A; that value must be a typedoc string.
- Base may be This or a TypeName. Traversal unwraps across Ref-typed intermediates.
- DocPath has no meaning outside typedoc intrinsics and Ref paths.

8. Imports and cross-document references

- _imports provides named imports of other typedocs for type reuse only (not symbols).
- Qualified type reference syntax: alias::TypeName and alias::Generic<...>.
- Imported types participate normally in unions, intersections, Keys, Ref, etc.
- Static constraint: alias::TypeName requires the alias source to be statically resolvable (typedoc string or host locator). DocPath-based imports are permitted for use in intrinsics (TypeNames/SymbolNames/SymbolType) but cannot be used with alias::TypeName.

9. Late-bound terms and two-phase model

- Authoring phase (static): parse and type-check TDL documents. Evaluate intrinsics with literal typedoc strings.
- Instantiation phase (late-bound): Evaluate intrinsics whose doc argument is a DocPath and any type constructs that depend on them (including Keys over late-bound). Resolve Refs that depend on runtime values.
- Late-bound propagation:
  - Any operator that requires structural introspection (e.g., Keys, "&" object-like check) remains late-bound until all operands are concrete.
  - Using late-bound EnumLikeExpr domains for index signatures is allowed; concrete key sets are determined at instantiation. If resolution does not yield an enum, error at instantiation.

10. Object-like

- After resolving aliases/generics/intersections, a type is object-like iff it denotes an object with explicit properties and/or index signatures. Not object-like: primitives, functions, typedoc, arity-0 externals (atomic).

11. Validation rules

- Primitive names in _primitives cannot be used as TypeName or TypeParam.
- TypeName must not be all-caps (must contain at least one lowercase letter).
- Intersections: all operands must be object-like (after alias/generic resolution); late-bound operands defer this check to instantiation.
- Index signature key type must be "string" or an EnumLikeExpr (possibly late-bound).
- Optional function parameters must be trailing.
- [] only on labels (properties, symbols); never in scalar TypeExpr; never on TypeName labels.
- Arity-0 externals are nominal, atomic (no &, no <...>).
- typedoc intrinsics accept only typedoc values or DocPaths; DocPath traversals unwrap across Ref.
- Ref: first parameter must be a concrete object-like or a RefPath; RefPath base must be This or a TypeName; last segment must denote a multi-valued collection (array or any index signature).
- This is valid only inside a named type’s body (with concrete generic substitution), including inline objects inside that body.
- Only concrete types may be referenced; unapplied generics invalid.
- RHS node types:
  - Allowed: scalar TypeExpr, block-mapping InlineObject.
  - Forbidden: any YAML flow collections (both {...} and [...] anywhere). Error: Flow YAML is not allowed; write a TDL type expression scalar or a block-mapping InlineObject instead.
- Curly-brace ban: { and } MUST NOT appear in unquoted scalar TypeExpr. Braces may appear inside quoted string literals.
- Unions of object: wrapper encoding MUST be accepted; if non-wrapper inline objects are used and multiple branches match, error and ask for wrapper encoding.

12. Style guide

- Open-by-default: define only what you need; forbid extras with [k: string]? never when you need a strict shape.
- Prefer by-type-name wrapper for unions of object types (A: {...} or B: {...}); it’s unambiguous and LLM-friendly.
- Use inline object shapes liberally for readability; define named types when reused.
- Property names lowercase; Type names Capitalized (not all-caps).
- Prefer Ref<T> over ad-hoc strings; prefer Ref<This.collection> for local selections.
- Prefer Ref<Base>.path sugar for remote selections; define domain aliases where helpful.
- Use Keys(T) to enumerate known keys when statically known; accept that it may be late-bound if T depends on a DocPath.
- Use imports (alias::TypeName) for cross-doc reuse; do not import symbols.
- Avoid YAML flow collections. For empty object shapes, define a named object type with an empty body and reference it.
- Use typedoc intrinsics with function-call syntax only.
- Optional alias: some hosts may provide InstanceNames(doc) as an alias of SymbolNames(doc) to ease migration from older “instances” wording; SymbolNames is canonical.