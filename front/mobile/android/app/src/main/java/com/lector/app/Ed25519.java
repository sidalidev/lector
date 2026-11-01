package com.lector.app;

import java.math.BigInteger;
import java.security.MessageDigest;
import java.util.Arrays;

/**
 * Ed25519 signature verification (RFC 8032), plain Java.
 *
 * The platform only ships Ed25519 from Android 13 while Lector supports Android 7, and the
 * update manifest is the one place a signature is checked: a small, dependency-free verifier
 * keeps the app free of extra libraries. Only verification, with public data: no secret is
 * handled here, so constant time does not matter.
 */
final class Ed25519 {

    private static final BigInteger P = BigInteger.ONE.shiftLeft(255).subtract(BigInteger.valueOf(19));
    private static final BigInteger L = BigInteger.ONE.shiftLeft(252)
        .add(new BigInteger("27742317777372353535851937790883648493"));
    private static final BigInteger D = BigInteger.valueOf(-121665)
        .multiply(BigInteger.valueOf(121666).modInverse(P)).mod(P);
    private static final BigInteger I = BigInteger.valueOf(2)
        .modPow(P.subtract(BigInteger.ONE).shiftRight(2), P);

    /** Base point: y = 4/5, x even. */
    private static final BigInteger[] B;

    static {
        BigInteger by = BigInteger.valueOf(4).multiply(BigInteger.valueOf(5).modInverse(P)).mod(P);
        B = new BigInteger[] { recoverX(by, 0), by };
    }

    private Ed25519() {}

    /** True only if {@code signature} (64 bytes) over {@code message} is valid for {@code publicKey} (32 bytes). */
    static boolean verify(byte[] publicKey, byte[] message, byte[] signature) {
        if (publicKey == null || publicKey.length != 32 || signature == null || signature.length != 64 || message == null) {
            return false;
        }
        try {
            BigInteger[] a = decodePoint(publicKey);
            byte[] rBytes = Arrays.copyOfRange(signature, 0, 32);
            BigInteger[] r = decodePoint(rBytes);
            if (a == null || r == null) return false;
            BigInteger s = littleEndian(Arrays.copyOfRange(signature, 32, 64));
            if (s.compareTo(L) >= 0) return false;

            MessageDigest sha = MessageDigest.getInstance("SHA-512");
            sha.update(rBytes);
            sha.update(publicKey);
            sha.update(message);
            BigInteger h = littleEndian(sha.digest()).mod(L);

            BigInteger[] left = multiply(B, s);
            BigInteger[] right = add(r, multiply(a, h));
            return left[0].equals(right[0]) && left[1].equals(right[1]);
        } catch (Exception e) {
            return false;
        }
    }

    private static BigInteger littleEndian(byte[] bytes) {
        byte[] be = new byte[bytes.length];
        for (int i = 0; i < bytes.length; i++) be[i] = bytes[bytes.length - 1 - i];
        return new BigInteger(1, be);
    }

    private static BigInteger[] decodePoint(byte[] encoded) {
        byte[] copy = encoded.clone();
        int sign = (copy[31] >> 7) & 1;
        copy[31] &= 0x7f;
        BigInteger y = littleEndian(copy);
        if (y.compareTo(P) >= 0) return null;
        BigInteger x = recoverX(y, sign);
        return x == null ? null : new BigInteger[] { x, y };
    }

    private static BigInteger recoverX(BigInteger y, int sign) {
        BigInteger y2 = y.multiply(y).mod(P);
        BigInteger x2 = y2.subtract(BigInteger.ONE)
            .multiply(D.multiply(y2).add(BigInteger.ONE).modInverse(P)).mod(P);
        if (x2.signum() == 0) return sign == 0 ? BigInteger.ZERO : null;
        BigInteger x = x2.modPow(P.add(BigInteger.valueOf(3)).shiftRight(3), P);
        if (!x.multiply(x).mod(P).equals(x2)) x = x.multiply(I).mod(P);
        if (!x.multiply(x).mod(P).equals(x2)) return null;
        if (x.testBit(0) != (sign == 1)) x = P.subtract(x);
        return x;
    }

    /** Twisted Edwards addition (complete for Ed25519), affine coordinates. */
    private static BigInteger[] add(BigInteger[] p1, BigInteger[] p2) {
        BigInteger x1 = p1[0], y1 = p1[1], x2 = p2[0], y2 = p2[1];
        BigInteger t = D.multiply(x1).multiply(x2).multiply(y1).multiply(y2).mod(P);
        BigInteger x3 = x1.multiply(y2).add(x2.multiply(y1))
            .multiply(BigInteger.ONE.add(t).modInverse(P)).mod(P);
        BigInteger y3 = y1.multiply(y2).add(x1.multiply(x2))
            .multiply(BigInteger.ONE.subtract(t).mod(P).modInverse(P)).mod(P);
        return new BigInteger[] { x3, y3 };
    }

    private static BigInteger[] multiply(BigInteger[] point, BigInteger scalar) {
        BigInteger[] result = { BigInteger.ZERO, BigInteger.ONE };
        BigInteger[] addend = point;
        for (int i = 0; i < scalar.bitLength(); i++) {
            if (scalar.testBit(i)) result = add(result, addend);
            addend = add(addend, addend);
        }
        return result;
    }
}
