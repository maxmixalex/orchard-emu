# SPDX-License-Identifier: MIT
# Diagnostic collector only; not linked into the machine or installed.
if(BUILD_TESTING)
  add_executable(orchard-arm-block-profile tests/arm-block-profile.c)
  target_include_directories(orchard-arm-block-profile PRIVATE include src)
  target_compile_features(orchard-arm-block-profile PRIVATE c_std_17)
  set_target_properties(orchard-arm-block-profile PROPERTIES C_EXTENSIONS OFF)
  add_test(NAME arm-block-profile-regression COMMAND orchard-arm-block-profile)
  set_tests_properties(arm-block-profile-regression PROPERTIES TIMEOUT 30)
  list(APPEND orchard_checked_targets orchard-arm-block-profile)
endif()
