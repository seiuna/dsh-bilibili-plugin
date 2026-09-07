const z = {
  object: (shape: any) => ({
    description: () => z.object(shape),
    default: () => z.object(shape),
  }),
  string: () => ({
    description: () => z.string(),
    default: () => z.string(),
  }),
  boolean: () => ({
    description: () => z.boolean(),
    default: () => z.boolean(),
  }),
  number: () => ({
    description: () => z.number(),
    default: () => z.number(),
  }),
};

export default z;
