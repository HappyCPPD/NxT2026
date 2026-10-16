#!/usr/bin/env python3
# Flag Checker 3000
# Only the real flag will pass. Good luck reversing it!

enc = [12, 59, 24, 60, 62, 50, 54, 36, 43, 53, 48, 40, 47, 51, 52, 44, 64, 56, 70, 58, 68, 70, 61, 61, 87]


def check(flag):
    if len(flag) != len(enc):
        return False
    for i, ch in enumerate(flag):
        if ((ord(ch) ^ 0x42) + i) % 256 != enc[i]:
            return False
    return True


if __name__ == "__main__":
    guess = input("Enter the flag: ")
    if check(guess):
        print("Correct! Submit it for points.")
    else:
        print("Wrong flag.")
