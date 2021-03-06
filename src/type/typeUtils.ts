// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Type } from ".";
import { ArrayUtils, MapUtils, Assert } from "../common";
import { ParameterScopeItem } from "../inspection";
import { Ast, AstUtils } from "../language";
import { NodeIdMap, NodeIdMapUtils, ParseContext, TXorNode, XorNodeKind } from "../parser";

export function genericFactory<T extends Type.TypeKind>(typeKind: T, isNullable: boolean): Type.IPrimitiveType<T> {
    return {
        kind: typeKind,
        maybeExtendedKind: undefined,
        isNullable,
    };
}

export function anyFactory(): Type.Any {
    return AnyConstant;
}

export function anyUnionFactory(unionedTypePairs: ReadonlyArray<Type.TType>, dedupeTypes: boolean = true): Type.TType {
    const simplified: ReadonlyArray<Type.TType> = dedupe(unionedTypePairs, dedupeTypes);
    if (simplified.length === 1) {
        return simplified[0];
    }

    return {
        kind: Type.TypeKind.Any,
        maybeExtendedKind: Type.ExtendedTypeKind.AnyUnion,
        isNullable: unionedTypePairs.find((ttype: Type.TType) => ttype.isNullable === true) !== undefined,
        unionedTypePairs: simplified,
    };
}

export function definedRecordFactory(
    isNullable: boolean,
    fields: Map<string, Type.TType>,
    isOpen: boolean,
): Type.DefinedRecord {
    return {
        kind: Type.TypeKind.Record,
        maybeExtendedKind: Type.ExtendedTypeKind.DefinedRecord,
        isNullable,
        fields,
        isOpen,
    };
}

export function definedTableFactory(
    isNullable: boolean,
    fields: Map<string, Type.TType>,
    isOpen: boolean,
): Type.DefinedTable {
    return {
        kind: Type.TypeKind.Table,
        maybeExtendedKind: Type.ExtendedTypeKind.DefinedTable,
        isNullable,
        fields,
        isOpen,
    };
}

export function unknownFactory(): Type.Unknown {
    return UnknownConstant;
}

export function noneFactory(): Type.None {
    return NoneConstant;
}

export function notApplicableFactory(): Type.NotApplicable {
    return NotApplicableConstant;
}

export function nullFactory(): Type.Null {
    return NullConstant;
}

export function parameterFactory(parameter: ParameterScopeItem): Type.TType {
    if (parameter.maybeType === undefined) {
        return unknownFactory();
    }

    return {
        kind: typeKindFromPrimitiveTypeConstantKind(parameter.maybeType),
        maybeExtendedKind: undefined,
        isNullable: parameter.isNullable,
    };
}

export function dedupe(types: ReadonlyArray<Type.TType>, combineAnys: boolean = true): ReadonlyArray<Type.TType> {
    const buckets: Map<string, Type.TType[]> = new Map();

    for (const current of types) {
        const key: string = `${current.kind},${current.maybeExtendedKind}`;
        const maybeColllection: Type.TType[] | undefined = buckets.get(key);
        // First type of TypeKind
        if (maybeColllection === undefined) {
            buckets.set(key, [current]);
        }
        // In the bucket for type.kind, check if it's the first with a deep equals comparison.
        else if (maybeColllection.find((type: Type.TType) => equalType(current, type)) === undefined) {
            maybeColllection.push(current);
        }
    }

    if (combineAnys === true) {
        const anyUnionKey: string = `${Type.TypeKind.Any},${Type.ExtendedTypeKind.AnyUnion}`;
        const maybeAnyUnions: ReadonlyArray<Type.TType> | undefined = buckets.get(anyUnionKey);
        if (maybeAnyUnions !== undefined) {
            buckets.set(anyUnionKey, [...combineAnyUnions(maybeAnyUnions as ReadonlyArray<Type.AnyUnion>)]);
        }
    }

    const result: Type.TType[] = [];
    for (types of buckets.values()) {
        result.push(...types);
    }

    return result;
}

export function combineAnyUnions(anyUnions: ReadonlyArray<Type.AnyUnion>): ReadonlyArray<Type.TType> {
    const [nullable, nonNullable]: [ReadonlyArray<Type.AnyUnion>, ReadonlyArray<Type.AnyUnion>] = ArrayUtils.split(
        anyUnions,
        (value: Type.AnyUnion) => value.isNullable === true,
    );

    const flattenedNullable: ReadonlyArray<Type.TType> = nullable
        .map((anyUnion: Type.AnyUnion) => anyUnion.unionedTypePairs)
        .reduce((flattened: Type.TType[], types: ReadonlyArray<Type.TType>, _currentIndex, _array): Type.TType[] => {
            flattened.push(...types);
            return flattened;
        }, []);
    const flattenedNonNullable: ReadonlyArray<Type.TType> = nonNullable
        .map((anyUnion: Type.AnyUnion) => anyUnion.unionedTypePairs)
        .reduce((flattened: Type.TType[], types: ReadonlyArray<Type.TType>, _currentIndex, _array): Type.TType[] => {
            flattened.push(...types);
            return flattened;
        }, []);

    const result: Type.TType[] = [];
    if (flattenedNullable.length !== 0) {
        result.push(anyUnionFactory(flattenedNullable, false));
    }
    if (flattenedNonNullable.length !== 0) {
        result.push(anyUnionFactory(flattenedNonNullable, false));
    }

    return result;
}

export function typeKindFromLiteralKind(literalKind: Ast.LiteralKind): Type.TypeKind {
    switch (literalKind) {
        case Ast.LiteralKind.List:
            return Type.TypeKind.List;

        case Ast.LiteralKind.Logical:
            return Type.TypeKind.Logical;

        case Ast.LiteralKind.Null:
            return Type.TypeKind.Null;

        case Ast.LiteralKind.Numeric:
            return Type.TypeKind.Number;

        case Ast.LiteralKind.Record:
            return Type.TypeKind.Record;

        case Ast.LiteralKind.Text:
            return Type.TypeKind.Text;

        default:
            throw Assert.isNever(literalKind);
    }
}

export function maybePrimitiveTypeConstantKindFromTypeKind(
    typeKind: Type.TypeKind,
): Ast.PrimitiveTypeConstantKind | undefined {
    switch (typeKind) {
        case Type.TypeKind.Action:
            return Ast.PrimitiveTypeConstantKind.Action;

        case Type.TypeKind.Any:
            return Ast.PrimitiveTypeConstantKind.Any;

        case Type.TypeKind.AnyNonNull:
            return Ast.PrimitiveTypeConstantKind.AnyNonNull;

        case Type.TypeKind.Binary:
            return Ast.PrimitiveTypeConstantKind.Binary;

        case Type.TypeKind.Date:
            return Ast.PrimitiveTypeConstantKind.Date;

        case Type.TypeKind.DateTime:
            return Ast.PrimitiveTypeConstantKind.DateTime;

        case Type.TypeKind.DateTimeZone:
            return Ast.PrimitiveTypeConstantKind.DateTimeZone;

        case Type.TypeKind.Duration:
            return Ast.PrimitiveTypeConstantKind.Duration;

        case Type.TypeKind.Function:
            return Ast.PrimitiveTypeConstantKind.Function;

        case Type.TypeKind.List:
            return Ast.PrimitiveTypeConstantKind.List;

        case Type.TypeKind.Logical:
            return Ast.PrimitiveTypeConstantKind.Logical;

        case Type.TypeKind.None:
            return Ast.PrimitiveTypeConstantKind.None;

        case Type.TypeKind.Null:
            return Ast.PrimitiveTypeConstantKind.Null;

        case Type.TypeKind.Number:
            return Ast.PrimitiveTypeConstantKind.Number;

        case Type.TypeKind.Record:
            return Ast.PrimitiveTypeConstantKind.Record;

        case Type.TypeKind.Table:
            return Ast.PrimitiveTypeConstantKind.Table;

        case Type.TypeKind.Text:
            return Ast.PrimitiveTypeConstantKind.Text;

        case Type.TypeKind.Time:
            return Ast.PrimitiveTypeConstantKind.Time;

        case Type.TypeKind.Type:
            return Ast.PrimitiveTypeConstantKind.Type;

        case Type.TypeKind.NotApplicable:
        case Type.TypeKind.Unknown:
            return undefined;

        default:
            throw Assert.isNever(typeKind);
    }
}

export function typeKindFromPrimitiveTypeConstantKind(
    primitiveTypeConstantKind: Ast.PrimitiveTypeConstantKind,
): Type.TypeKind {
    switch (primitiveTypeConstantKind) {
        case Ast.PrimitiveTypeConstantKind.Action:
            return Type.TypeKind.Action;

        case Ast.PrimitiveTypeConstantKind.Any:
            return Type.TypeKind.Any;

        case Ast.PrimitiveTypeConstantKind.AnyNonNull:
            return Type.TypeKind.AnyNonNull;

        case Ast.PrimitiveTypeConstantKind.Binary:
            return Type.TypeKind.Binary;

        case Ast.PrimitiveTypeConstantKind.Date:
            return Type.TypeKind.Date;

        case Ast.PrimitiveTypeConstantKind.DateTime:
            return Type.TypeKind.DateTime;

        case Ast.PrimitiveTypeConstantKind.DateTimeZone:
            return Type.TypeKind.DateTimeZone;

        case Ast.PrimitiveTypeConstantKind.Duration:
            return Type.TypeKind.Duration;

        case Ast.PrimitiveTypeConstantKind.Function:
            return Type.TypeKind.Function;

        case Ast.PrimitiveTypeConstantKind.List:
            return Type.TypeKind.List;

        case Ast.PrimitiveTypeConstantKind.Logical:
            return Type.TypeKind.Logical;

        case Ast.PrimitiveTypeConstantKind.None:
            return Type.TypeKind.None;

        case Ast.PrimitiveTypeConstantKind.Null:
            return Type.TypeKind.Null;

        case Ast.PrimitiveTypeConstantKind.Number:
            return Type.TypeKind.Number;

        case Ast.PrimitiveTypeConstantKind.Record:
            return Type.TypeKind.Record;

        case Ast.PrimitiveTypeConstantKind.Table:
            return Type.TypeKind.Table;

        case Ast.PrimitiveTypeConstantKind.Text:
            return Type.TypeKind.Text;

        case Ast.PrimitiveTypeConstantKind.Time:
            return Type.TypeKind.Time;

        case Ast.PrimitiveTypeConstantKind.Type:
            return Type.TypeKind.Type;

        default:
            throw Assert.isNever(primitiveTypeConstantKind);
    }
}

export function equalType(left: Type.TType, right: Type.TType): boolean {
    if (left.kind !== right.kind) {
        return false;
    } else if (left.maybeExtendedKind !== undefined && right.maybeExtendedKind !== undefined) {
        return equalExtendedTypes(left, right);
    } else if (left.isNullable !== right.isNullable) {
        return false;
    } else {
        return true;
    }
}

export function equalTypes(leftTypes: ReadonlyArray<Type.TType>, rightTypes: ReadonlyArray<Type.TType>): boolean {
    if (leftTypes.length !== rightTypes.length) {
        return false;
    }

    const numTypes: number = leftTypes.length;
    for (let index: number = 0; index < numTypes; index += 1) {
        if (equalType(leftTypes[index], rightTypes[index]) === false) {
            return false;
        }
    }

    return true;
}

export function equalExtendedTypes<T extends Type.TType>(left: Type.TExtendedType, right: Type.TExtendedType): boolean {
    if (left.maybeExtendedKind !== right.maybeExtendedKind) {
        return false;
    }

    switch (left.maybeExtendedKind) {
        case Type.ExtendedTypeKind.AnyUnion:
            return equalAnyUnion(left, right as Type.AnyUnion);

        case Type.ExtendedTypeKind.DefinedFunction:
            return equalDefinedFunction(left, right as Type.DefinedFunction);

        case Type.ExtendedTypeKind.DefinedList:
            return equalDefinedList(left, right as Type.DefinedList);

        case Type.ExtendedTypeKind.DefinedRecord:
            return equalDefinedRecord(left, right as Type.DefinedRecord);

        case Type.ExtendedTypeKind.DefinedTable:
            return equalDefinedTable(left, right as Type.DefinedTable);

        case Type.ExtendedTypeKind.DefinedType:
            return equalDefinedType(left, right as Type.DefinedType<T>);

        case Type.ExtendedTypeKind.ListType:
            return equalListType(left, right as Type.ListType);

        case Type.ExtendedTypeKind.PrimaryExpressionTable:
            return equalPrimaryExpressionTable(left, right as Type.PrimaryExpressionTable);

        default:
            throw Assert.isNever(left);
    }
}

export function equalAnyUnion(left: Type.AnyUnion, right: Type.AnyUnion): boolean {
    return left.isNullable === right.isNullable && equalTypes(left.unionedTypePairs, right.unionedTypePairs);
}

export function equalDefinedFunction(left: Type.DefinedFunction, right: Type.DefinedFunction): boolean {
    return (
        left.isNullable === right.isNullable &&
        equalType(left.returnType, right.returnType) &&
        equalDefinedFunctionParameters(left.parameters, right.parameters)
    );
}

export function equalDefinedFunctionParameters(
    left: ReadonlyArray<Type.FunctionParameter>,
    right: ReadonlyArray<Type.FunctionParameter>,
): boolean {
    if (left.length !== right.length) {
        return false;
    }

    const numParameters: number = left.length;
    for (let index: number = 0; index < numParameters; index += 1) {
        const nthLeft: Type.FunctionParameter = left[index];
        const nthRight: Type.FunctionParameter = right[index];
        if (
            nthLeft.isNullable !== nthRight.isNullable ||
            nthLeft.isOptional !== nthRight.isOptional ||
            nthLeft.maybeType !== nthRight.maybeType
        ) {
            return false;
        }
    }

    return true;
}

export function equalDefinedList(left: Type.DefinedList, right: Type.DefinedList): boolean {
    if (left.elements.length !== right.elements.length || left.isNullable !== right.isNullable) {
        return false;
    }

    const rightElements: ReadonlyArray<Type.TType> = right.elements;
    return ArrayUtils.all(
        left.elements.map((leftType: Type.TType, index: number) => equalType(leftType, rightElements[index])),
    );
}

export function equalDefinedRecord(left: Type.DefinedRecord, right: Type.DefinedRecord): boolean {
    return (
        left.isNullable === right.isNullable &&
        MapUtils.equalMaps<string, Type.TType>(left.fields, right.fields, equalType)
    );
}

export function equalDefinedTable(left: Type.DefinedTable, right: Type.DefinedTable): boolean {
    return (
        left.isNullable === right.isNullable &&
        MapUtils.equalMaps<string, Type.TType>(left.fields, right.fields, equalType)
    );
}

export function equalDefinedType<T extends Type.TType>(left: Type.DefinedType<T>, right: Type.DefinedType<T>): boolean {
    return left.isNullable === right.isNullable && equalType(left.primaryType, right.primaryType);
}

export function equalListType(left: Type.ListType, right: Type.ListType): boolean {
    return left.isNullable === right.isNullable && equalType(left.itemType, right.itemType);
}

export function equalPrimaryExpressionTable(
    left: Type.PrimaryExpressionTable,
    right: Type.PrimaryExpressionTable,
): boolean {
    return equalType(left.type, right.type);
}

export function inspectParameter(
    nodeIdMapCollection: NodeIdMap.Collection,
    parameter: TXorNode,
): Type.FunctionParameter | undefined {
    switch (parameter.kind) {
        case XorNodeKind.Ast:
            return inspectAstParameter(parameter.node as Ast.TParameter);

        case XorNodeKind.Context:
            return inspectContextParameter(nodeIdMapCollection, parameter.node);

        default:
            throw Assert.isNever(parameter);
    }
}

function inspectAstParameter(node: Ast.TParameter): Type.FunctionParameter {
    let isNullable: boolean;
    let maybeType: Type.TypeKind | undefined;

    const maybeParameterType: Ast.TParameterType | undefined = node.maybeParameterType;
    if (maybeParameterType !== undefined) {
        const parameterType: Ast.TParameterType = maybeParameterType;

        switch (parameterType.kind) {
            case Ast.NodeKind.AsNullablePrimitiveType: {
                const simplified: AstUtils.SimplifiedType = AstUtils.simplifyAsNullablePrimitiveType(parameterType);
                isNullable = simplified.isNullable;
                maybeType = typeKindFromPrimitiveTypeConstantKind(simplified.primitiveTypeConstantKind);
                break;
            }

            case Ast.NodeKind.AsType: {
                const simplified: AstUtils.SimplifiedType = AstUtils.simplifyType(parameterType.paired);
                isNullable = simplified.isNullable;
                maybeType = typeKindFromPrimitiveTypeConstantKind(simplified.primitiveTypeConstantKind);
                break;
            }

            default:
                throw Assert.isNever(parameterType);
        }
    } else {
        isNullable = true;
        maybeType = undefined;
    }

    return {
        isNullable,
        isOptional: node.maybeOptionalConstant !== undefined,
        maybeType,
    };
}

function inspectContextParameter(
    nodeIdMapCollection: NodeIdMap.Collection,
    parameter: ParseContext.Node,
): Type.FunctionParameter | undefined {
    let isOptional: boolean;
    let isNullable: boolean;
    let maybeType: Type.TypeKind | undefined;

    const maybeName: Ast.TNode | undefined = NodeIdMapUtils.maybeAstChildByAttributeIndex(
        nodeIdMapCollection,
        parameter.id,
        1,
        [Ast.NodeKind.Identifier],
    );
    if (maybeName === undefined) {
        return undefined;
    }

    const maybeOptional: Ast.TNode | undefined = NodeIdMapUtils.maybeAstChildByAttributeIndex(
        nodeIdMapCollection,
        parameter.id,
        0,
        [Ast.NodeKind.Constant],
    );
    isOptional = maybeOptional !== undefined;

    const maybeParameterType: Ast.TNode | undefined = NodeIdMapUtils.maybeAstChildByAttributeIndex(
        nodeIdMapCollection,
        parameter.id,
        2,
        undefined,
    );
    if (maybeParameterType !== undefined) {
        const parameterType: Ast.AsNullablePrimitiveType = maybeParameterType as Ast.AsNullablePrimitiveType;
        const simplified: AstUtils.SimplifiedType = AstUtils.simplifyAsNullablePrimitiveType(parameterType);
        isNullable = simplified.isNullable;
        maybeType = typeKindFromPrimitiveTypeConstantKind(simplified.primitiveTypeConstantKind);
    } else {
        isNullable = true;
        maybeType = undefined;
    }

    return {
        isOptional,
        isNullable,
        maybeType,
    };
}

const AnyConstant: Type.Any = {
    kind: Type.TypeKind.Any,
    maybeExtendedKind: undefined,
    isNullable: false,
};

const NoneConstant: Type.None = {
    kind: Type.TypeKind.None,
    maybeExtendedKind: undefined,
    isNullable: false,
};

const NotApplicableConstant: Type.NotApplicable = {
    kind: Type.TypeKind.NotApplicable,
    maybeExtendedKind: undefined,
    isNullable: false,
};

const NullConstant: Type.Null = {
    kind: Type.TypeKind.Null,
    maybeExtendedKind: undefined,
    isNullable: false,
};

const UnknownConstant: Type.Unknown = {
    kind: Type.TypeKind.Unknown,
    maybeExtendedKind: undefined,
    isNullable: false,
};
